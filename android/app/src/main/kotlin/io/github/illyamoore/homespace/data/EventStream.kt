package io.github.illyamoore.homespace.data

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

/** What the daemon pushes down /api/events, in the shapes the UI reacts to. */
sealed interface ServerEvent {
    data object Connected : ServerEvent
    data class Disconnected(val reason: String?) : ServerEvent
    data class SessionCreated(val sessionId: String, val agentId: String?) : ServerEvent
    data class SessionStatus(val sessionId: String, val status: String) : ServerEvent
    data class SessionMessage(val sessionId: String, val entry: TranscriptEntry) : ServerEvent
    data class SessionClosed(val sessionId: String, val code: Int?) : ServerEvent
    data class AgentChanged(val agentId: String) : ServerEvent
}

/**
 * The daemon's SSE stream as a cold Flow.
 *
 * OkHttp's EventSource already reconnects on a dropped connection, but it does
 * not surface the gap; `Disconnected` is emitted so the UI can show that it is
 * no longer live, and the caller re-subscribes. A zero read timeout is
 * essential — the default 120s would tear down a healthy but quiet stream.
 */
class EventStream(
    private val client: HomeSpaceClient,
    private val http: OkHttpClient = HomeSpaceClient.shared,
    private val json: Json = HomeSpaceClient.json,
) {
    fun events(sessionId: String? = null): Flow<ServerEvent> = callbackFlow {
        val sseClient = http.newBuilder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .build()

        val request = client.authorizedRequest(client.eventsUrl(sessionId))

        val listener = object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                trySend(ServerEvent.Connected)
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                parse(type, data)?.let { trySend(it) }
            }

            override fun onClosed(eventSource: EventSource) {
                trySend(ServerEvent.Disconnected(null))
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                val reason = t?.message ?: response?.let { "HTTP ${it.code}" }
                trySend(ServerEvent.Disconnected(reason))
                // A 401 will never recover on retry, so end the flow and let the
                // caller re-pair instead of hammering the daemon.
                if (response?.code == 401) close(ApiException(401, "token rejected"))
            }
        }

        val source = EventSources.createFactory(sseClient).newEventSource(request, listener)
        awaitClose { source.cancel() }
    }

    /** Visible for tests: turns one SSE frame into an event, or null to ignore. */
    internal fun parse(type: String?, data: String): ServerEvent? {
        val payload = runCatching { json.parseToJsonElement(data) as? JsonObject }.getOrNull() ?: return null
        fun str(key: String) = payload[key]?.jsonPrimitive?.contentOrNullSafe()

        return when (type) {
            "hello" -> ServerEvent.Connected
            "session.created" ->
                str("sessionId")?.let { ServerEvent.SessionCreated(it, str("agentId")) }
            "session.status" -> {
                val id = str("sessionId") ?: return null
                ServerEvent.SessionStatus(id, str("status") ?: "idle")
            }
            "session.closed" -> {
                val id = str("sessionId") ?: return null
                ServerEvent.SessionClosed(id, str("code")?.toIntOrNull())
            }
            "session.message" -> {
                val id = str("sessionId") ?: return null
                val entryJson = payload["entry"] ?: return null
                val entry = runCatching {
                    json.decodeFromJsonElement(TranscriptEntry.serializer(), entryJson)
                }.getOrNull() ?: return null
                // Frames without a seq are the CLI's partial-token envelopes,
                // which the daemon does not store and the UI does not render.
                if (entry.seq <= 0) null else ServerEvent.SessionMessage(id, entry)
            }
            "agent.created", "agent.updated", "agent.deleted" ->
                str("agentId")?.let { ServerEvent.AgentChanged(it) }
            else -> null
        }
    }
}

/** `jsonPrimitive.content` renders a JSON null as the string "null"; this
 *  keeps an absent agentId absent instead of turning it into text. */
private fun kotlinx.serialization.json.JsonPrimitive.contentOrNullSafe(): String? =
    if (this is kotlinx.serialization.json.JsonNull) null else content
