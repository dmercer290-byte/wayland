package com.genesis.wayland.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.genesis.wayland.data.ChatMessage
import com.genesis.wayland.data.Conversation
import com.genesis.wayland.data.SyncStore
import com.genesis.wayland.net.BridgeClient
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

class AppViewModel(app: Application) : AndroidViewModel(app) {
  sealed interface Screen {
    data object Connect : Screen
    data object Conversations : Screen
    data class Chat(val conversation: Conversation) : Screen
  }

  private val store = SyncStore(app)
  private val prefs = app.getSharedPreferences("wayland", 0)
  private var client: BridgeClient? = null

  var screen by mutableStateOf<Screen>(Screen.Connect); private set
  var busy by mutableStateOf(false); private set
  var online by mutableStateOf(false); private set
  var error by mutableStateOf<String?>(null); private set
  var conversations by mutableStateOf(store.loadConversations()); private set
  var messages by mutableStateOf<List<ChatMessage>>(emptyList()); private set

  val hasCache get() = conversations.isNotEmpty()
  val lastUrl: String get() = prefs.getString("url", "http://192.168.1.10:3000") ?: ""
  val lastUser: String get() = prefs.getString("user", "admin") ?: ""

  fun connect(url: String, user: String, pass: String) = connectWith(url, user) { it.login(user, pass) }

  /** Pairing-code login (the desktop's QR page shows the token). */
  fun pair(url: String, qrToken: String) = connectWith(url, lastUser) { it.qrLogin(qrToken) }

  private fun connectWith(url: String, user: String, auth: suspend (BridgeClient) -> Unit) {
    busy = true; error = null
    viewModelScope.launch {
      runCatching {
        val c = BridgeClient(url)
        auth(c)
        c.connect()
        c.onClosed = { online = false }
        c.onEvent = { name, data -> onBridgeEvent(name, data) }
        client = c
        prefs.edit().putString("url", url).putString("user", user).apply()
        syncConversations()
      }.onFailure { error = it.message }
        .onSuccess {
          online = true
          screen = Screen.Conversations
        }
      busy = false
    }
  }

  fun browseOffline() {
    online = false
    screen = Screen.Conversations
  }

  fun openConversation(c: Conversation) {
    messages = store.loadMessages(c.id)
    screen = Screen.Chat(c)
    if (online) viewModelScope.launch { runCatching { syncMessages(c.id) }.onFailure { error = it.message } }
  }

  fun backToList() {
    screen = Screen.Conversations
    error = null
  }

  fun send(c: Conversation, text: String) {
    val cl = client ?: return
    busy = true; error = null
    viewModelScope.launch {
      runCatching {
        // ISendMessageParams: input + msg_id + conversation_id (ipcBridge.ts).
        cl.invoke(
          BridgeClient.P_SEND,
          buildJsonObject {
            put("conversation_id", c.id)
            put("input", text)
            put("msg_id", java.util.UUID.randomUUID().toString())
          },
          timeoutMs = 120_000
        )
        syncMessages(c.id)
      }.onFailure { error = it.message }
      busy = false
    }
  }

  /**
   * Streamed agent output arrives as chat.response.stream broadcasts. Rather
   * than reimplement the renderer's incremental IResponseMessage merge, treat
   * each event for the open conversation as a change signal and re-fetch,
   * throttled to one refresh per second.
   */
  private var refreshQueued = false
  private fun onBridgeEvent(name: String, data: kotlinx.serialization.json.JsonElement?) {
    if (name != BridgeClient.E_RESPONSE_STREAM) return
    val current = (screen as? Screen.Chat)?.conversation?.id ?: return
    val convId = runCatching {
      (data as? kotlinx.serialization.json.JsonObject)
        ?.get("conversation_id")?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
    }.getOrNull()
    if (convId != null && convId != current) return
    if (refreshQueued) return
    refreshQueued = true
    viewModelScope.launch {
      kotlinx.coroutines.delay(1_000)
      refreshQueued = false
      runCatching { syncMessages(current) }
    }
  }

  private suspend fun syncConversations() {
    val cl = client ?: return
    val raw = cl.invoke(
      BridgeClient.P_CONVERSATIONS,
      buildJsonObject { put("page", 1); put("pageSize", 100) }
    )
    store.saveConversations(raw)
    conversations = store.loadConversations()
  }

  private suspend fun syncMessages(conversationId: String) {
    val cl = client ?: return
    val raw = cl.invoke(
      BridgeClient.P_MESSAGES,
      buildJsonObject {
        put("conversation_id", conversationId)
        put("page", 1)
        put("pageSize", 200)
      }
    )
    store.saveMessages(conversationId, raw)
    messages = store.loadMessages(conversationId)
  }

  override fun onCleared() {
    client?.close()
  }
}
