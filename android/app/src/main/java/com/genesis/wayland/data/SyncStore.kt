package com.genesis.wayland.data

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File

@Serializable
data class Conversation(val id: String, val name: String, val modifyTime: Long = 0)

@Serializable
data class ChatMessage(val id: String, val role: String, val text: String, val ts: Long = 0)

/**
 * Offline cache: last-synced conversations + per-conversation messages as
 * JSON files under filesDir/sync. "Standalone" reading works with the server
 * unreachable; a sync refreshes whatever it can fetch.
 */
class SyncStore(context: Context) {
  private val dir = File(context.filesDir, "sync").apply { mkdirs() }
  private val json = Json { ignoreUnknownKeys = true }

  fun saveConversations(raw: JsonElement) {
    File(dir, "conversations.json").writeText(raw.toString())
  }

  fun loadConversations(): List<Conversation> {
    val f = File(dir, "conversations.json")
    if (!f.exists()) return emptyList()
    val arr = runCatching { json.parseToJsonElement(f.readText()).jsonArray }.getOrNull() ?: return emptyList()
    return arr.mapNotNull { el ->
      val o = el.jsonObject
      val id = o["id"]?.jsonPrimitive?.content ?: return@mapNotNull null
      Conversation(
        id = id,
        name = o["name"]?.jsonPrimitive?.content ?: id,
        modifyTime = o["modifyTime"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0,
      )
    }.sortedByDescending { it.modifyTime }
  }

  fun saveMessages(conversationId: String, raw: JsonElement) {
    File(dir, "msg-${conversationId.filter { it.isLetterOrDigit() || it == '-' }}.json")
      .writeText(raw.toString())
  }

  fun loadMessages(conversationId: String): List<ChatMessage> {
    val f = File(dir, "msg-${conversationId.filter { it.isLetterOrDigit() || it == '-' }}.json")
    if (!f.exists()) return emptyList()
    val arr = runCatching { json.parseToJsonElement(f.readText()).jsonArray }.getOrNull() ?: return emptyList()
    return arr.mapNotNull { el -> parseMessage(el) }
  }

  /**
   * TMessage is a rich union (text / tool calls / thinking blocks). For the
   * phone cache we extract a plain-text projection and keep the raw JSON on
   * disk so nothing is lost for a future richer renderer.
   */
  private fun parseMessage(el: JsonElement): ChatMessage? {
    val o = el.jsonObject
    val id = o["id"]?.jsonPrimitive?.content ?: return null
    val role = o["position"]?.jsonPrimitive?.content
      ?: o["role"]?.jsonPrimitive?.content ?: "assistant"
    val content = o["content"]
    val text = when {
      content == null -> ""
      content is JsonArray -> content.joinToString("") { block ->
        block.jsonObject["content"]?.jsonPrimitive?.content
          ?: block.jsonObject["text"]?.jsonPrimitive?.content ?: ""
      }
      else -> runCatching { content.jsonObject["content"]?.jsonPrimitive?.content }.getOrNull()
        ?: runCatching { content.jsonPrimitive.content }.getOrNull() ?: ""
    }
    val ts = o["createdAt"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0
    return ChatMessage(id = id, role = role, text = text, ts = ts)
  }
}
