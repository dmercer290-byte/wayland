package com.genesis.wayland.net

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.random.Random

/**
 * Client for the Wayland server's remote bridge.
 *
 * Protocol (verified against the server source, see
 * docs/guides/android-app.md#protocol in the wayland repo):
 *
 *  1. POST /login {username, password} - the server sets an auth cookie.
 *  2. GET /api/ws-token - short-lived token for the WebSocket.
 *  3. WebSocket frames are JSON `{"name": string, "data": any}` both ways.
 *     Server pings arrive as name "ping"; reply with
 *     `{"name":"pong","data":{"timestamp":<ms>}}` or the server drops us.
 *  4. RPC (the @office-ai/platform bridge envelope):
 *     request:  name = "subscribe-<provider>",
 *               data = {"id": "<provider><8 hex>", "data": <args>}
 *     response: name = "subscribe.callback-<provider><id>", data = <result>.
 */
class BridgeClient(baseUrl: String) {
  val base: HttpUrl = baseUrl.trim().trimEnd('/').toHttpUrl()
  private val json = Json { ignoreUnknownKeys = true }

  // The server's JWT lives in a cookie; keep a trivial in-memory jar.
  private val cookies = ConcurrentHashMap<String, Cookie>()
  private val http = OkHttpClient.Builder()
    .cookieJar(object : CookieJar {
      override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        cookies.forEach { this@BridgeClient.cookies[it.name] = it }
      }
      override fun loadForRequest(url: HttpUrl): List<Cookie> = cookies.values.toList()
    })
    .build()

  private var ws: WebSocket? = null
  private val pending = ConcurrentHashMap<String, CompletableDeferred<JsonElement>>()

  /** Emitter frames that are not RPC callbacks (streamed message updates etc.). */
  var onEvent: ((name: String, data: JsonElement?) -> Unit)? = null
  var onClosed: ((reason: String) -> Unit)? = null

  suspend fun login(username: String, password: String) {
    val body = buildJsonObject {
      put("username", username)
      put("password", password)
    }
    val res = call(
      Request.Builder()
        .url(base.newBuilder().addPathSegment("login").build())
        .post(body.toString().toRequestBody("application/json".toMediaType()))
        .build()
    )
    res.use {
      if (!it.isSuccessful) throw IOException("Login failed: HTTP ${it.code}")
    }
  }

  suspend fun connect() {
    val tokenRes = call(
      Request.Builder().url(base.newBuilder().addPathSegments("api/ws-token").build()).build()
    )
    val token = tokenRes.use {
      if (!it.isSuccessful) throw IOException("ws-token failed: HTTP ${it.code}")
      val obj = json.parseToJsonElement(it.body!!.string()).jsonObject
      (obj["token"] ?: obj["data"]?.jsonObject?.get("token"))?.jsonPrimitive?.content
        ?: throw IOException("ws-token response had no token")
    }

    val wsScheme = if (base.isHttps) "wss" else "ws"
    val wsUrl = base.newBuilder().addQueryParameter("token", token).build()
      .toString().replaceFirst(base.scheme, wsScheme)

    val opened = CompletableDeferred<Unit>()
    ws = http.newWebSocket(
      Request.Builder().url(wsUrl).build(),
      object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
          opened.complete(Unit)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
          val frame = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
          val name = frame["name"]?.jsonPrimitive?.content ?: return
          val data = frame["data"]
          when {
            name == "ping" -> send("pong", buildJsonObject { put("timestamp", System.currentTimeMillis()) })
            name.startsWith(CALLBACK_PREFIX) -> {
              pending.remove(name.removePrefix(CALLBACK_PREFIX))?.complete(data ?: JsonObject(emptyMap()))
            }
            else -> onEvent?.invoke(name, data)
          }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
          if (!opened.isCompleted) opened.completeExceptionally(t)
          failAllPending(IOException("WebSocket failure: ${t.message}"))
          onClosed?.invoke(t.message ?: "failure")
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
          failAllPending(IOException("WebSocket closed: $code $reason"))
          onClosed?.invoke(reason.ifEmpty { "closed $code" })
        }
      }
    )
    opened.await()
  }

  /** Invoke a bridge provider and await its result. */
  suspend fun invoke(provider: String, args: JsonElement, timeoutMs: Long = 30_000): JsonElement {
    val socket = ws ?: throw IOException("Not connected")
    val id = provider + Random.nextBytes(4).joinToString("") { "%02x".format(it) }
    val deferred = CompletableDeferred<JsonElement>()
    pending[provider + id] = deferred
    val frame = buildJsonObject {
      put("name", "subscribe-$provider")
      put("data", buildJsonObject {
        put("id", id)
        put("data", args)
      })
    }
    if (!socket.send(frame.toString())) {
      pending.remove(provider + id)
      throw IOException("WebSocket send failed")
    }
    return withTimeout(timeoutMs) { deferred.await() }
  }

  private fun send(name: String, data: JsonElement) {
    ws?.send(buildJsonObject { put("name", name); put("data", data) }.toString())
  }

  fun close() {
    ws?.close(1000, "bye")
    ws = null
    failAllPending(IOException("Client closed"))
  }

  private fun failAllPending(cause: IOException) {
    pending.values.forEach { it.completeExceptionally(cause) }
    pending.clear()
  }

  private suspend fun call(request: Request): Response =
    suspendCancellableCoroutine { cont ->
      val c = http.newCall(request)
      cont.invokeOnCancellation { c.cancel() }
      c.enqueue(object : okhttp3.Callback {
        override fun onFailure(call: okhttp3.Call, e: IOException) = cont.resumeWithException(e)
        override fun onResponse(call: okhttp3.Call, response: Response) = cont.resume(response)
      })
    }

  companion object {
    private const val CALLBACK_PREFIX = "subscribe.callback-"

    // Provider names verified against src/common/adapter/ipcBridge.ts.
    const val P_CONVERSATIONS = "database.get-user-conversations"
    const val P_MESSAGES = "database.get-conversation-messages"
    const val P_SEND = "chat.send.message"
    const val P_CREATE = "create-conversation"
  }
}
