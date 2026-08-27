package io.github.illyamoore.homespace.data

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/** A failure the UI can show verbatim. `status` is 0 for transport errors. */
class ApiException(val status: Int, message: String) : IOException(message) {
    val isUnauthorized: Boolean get() = status == 401
}

/** Everything needed to reach one daemon. */
data class ServerRef(
    val id: String,
    val name: String,
    val baseUrl: String,
    val token: String,
) {
    val isCleartext: Boolean get() = baseUrl.startsWith("http://", ignoreCase = true)
}

/**
 * Typed client for the daemon.
 *
 * One OkHttp instance is shared across every server the app talks to so the
 * connection pool and thread pool are not duplicated; the per-server bearer
 * token is attached per request rather than by an interceptor, because a single
 * client may be used against more than one NAS during a session.
 */
class HomeSpaceClient(
    private val server: ServerRef,
    private val http: OkHttpClient = shared,
) {
    companion object {
        val json: Json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = false
            coerceInputValues = true
        }

        private val jsonMedia = "application/json; charset=utf-8".toMediaType()

        /**
         * Read timeout is generous because a turn can take minutes; the SSE
         * stream sets its own (none) and long polls are not used elsewhere.
         */
        val shared: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(120, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build()
        }

        /**
         * Accepts what a person actually types: "nas.local", "nas.local:7333",
         * "http://nas.local:7333/", or a reverse-proxy prefix such as
         * "https://home.example.com/homespace/".
         *
         * The result is rebuilt from the parsed URL rather than trimmed as a
         * string. Trimming first is what turned a bare "http://" into
         * "http://http:" — and rebuilding also drops any query or fragment that
         * came along with a pasted address, which would otherwise corrupt every
         * request built on top of it.
         *
         * Returns null when the input cannot be a URL at all, so the caller can
         * say so before attempting a request.
         */
        fun normalizeBaseUrl(input: String): String? {
            val trimmed = input.trim()
            if (trimmed.isEmpty()) return null
            // A leading slash means a path was pasted, not an address. Left
            // alone, prepending a scheme makes OkHttp read the first segment
            // as the host ("/just/a/path" -> host "just"), which then fails at
            // connect time with a confusing DNS error instead of here.
            if (trimmed.startsWith("/")) return null

            val hasScheme = trimmed.startsWith("http://", true) || trimmed.startsWith("https://", true)
            val parsed = (if (hasScheme) trimmed else "http://$trimmed").toHttpUrlOrNull() ?: return null
            if (parsed.host.isBlank()) return null

            return buildString {
                append(parsed.scheme).append("://").append(parsed.host)
                if (parsed.port != HttpUrl.defaultPort(parsed.scheme)) {
                    append(':').append(parsed.port)
                }
                // A subpath is kept so the app works behind a reverse proxy;
                // the trailing slash is not, so segments append cleanly.
                append(parsed.encodedPath.trimEnd('/'))
            }
        }
    }

    private val base: HttpUrl =
        server.baseUrl.toHttpUrlOrNull() ?: throw ApiException(0, "invalid server address: ${server.baseUrl}")

    private fun url(vararg segments: String, query: Map<String, String?> = emptyMap()): HttpUrl =
        base.newBuilder().apply {
            segments.forEach { addPathSegment(it) }
            query.forEach { (key, value) -> if (!value.isNullOrEmpty()) addQueryParameter(key, value) }
        }.build()

    /**
     * File paths arrive as "docs/deep/file.txt" and must stay multi-segment in
     * the URL — the daemon's wildcard route wants the slashes — while each
     * segment is still encoded. addPathSegment does exactly that per call.
     */
    private fun HttpUrl.Builder.addFilePath(path: String) = apply {
        path.split('/').filter { it.isNotEmpty() }.forEach { addPathSegment(it) }
    }

    private fun filesUrl(rootId: String, verb: String, path: String, query: Map<String, String?> = emptyMap()): HttpUrl =
        base.newBuilder()
            .addPathSegment("api").addPathSegment("files")
            .addPathSegment(rootId).addPathSegment(verb)
            .addFilePath(path)
            .apply { query.forEach { (k, v) -> if (!v.isNullOrEmpty()) addQueryParameter(k, v) } }
            .build()

    private fun request(url: HttpUrl, method: String = "GET", body: String? = null): Request =
        Request.Builder()
            .url(url)
            .header("Authorization", "Bearer ${server.token}")
            .header("Accept", "application/json")
            .apply {
                when (method) {
                    "GET" -> get()
                    "DELETE" -> delete()
                    else -> method(method, (body ?: "{}").toRequestBody(jsonMedia))
                }
            }
            .build()

    private suspend fun execute(request: Request): String = withContext(Dispatchers.IO) {
        val response = http.newCall(request).await()
        response.use {
            val text = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                val message = runCatching { json.decodeFromString<ApiErrorBody>(text).error }
                    .getOrElse { _ -> it.message.ifBlank { "request failed (${it.code})" } }
                throw ApiException(it.code, message)
            }
            text
        }
    }

    private suspend inline fun <reified T> get(url: HttpUrl): T =
        json.decodeFromString(execute(request(url)))

    private suspend inline fun <reified T> send(url: HttpUrl, method: String, body: String? = null): T =
        json.decodeFromString(execute(request(url, method, body)))

    // ------------------------------------------------------------ endpoints

    suspend fun health(): Health = get(url("api", "health"))

    suspend fun system(): SystemSnapshot = get(url("api", "system"))

    suspend fun roots(): RootsResponse = get(url("api", "files"))

    suspend fun list(rootId: String, path: String, showHidden: Boolean = false): Listing =
        get(filesUrl(rootId, "list", path, mapOf("hidden" to if (showHidden) "1" else null)))

    suspend fun read(rootId: String, path: String): FileDetail =
        get(filesUrl(rootId, "read", path))

    suspend fun search(rootId: String, query: String): SearchResult =
        get(
            base.newBuilder()
                .addPathSegment("api").addPathSegment("files")
                .addPathSegment(rootId).addPathSegment("search")
                .addQueryParameter("q", query)
                .build(),
        )

    /**
     * Raw file URL. Coil and ExoPlayer both fetch this themselves, so the token
     * rides in the query string — neither lets a per-request header be attached
     * as simply as OkHttp does, and the daemon accepts both forms.
     */
    fun rawUrl(rootId: String, path: String, download: Boolean = false): String =
        filesUrl(
            rootId, "raw", path,
            mapOf("token" to server.token, "download" to if (download) "1" else null),
        ).toString()

    suspend fun sessions(): SessionsResponse = get(url("api", "sessions"))

    suspend fun session(id: String): Session = get(url("api", "sessions", id))

    suspend fun transcript(id: String, since: Long? = null): TranscriptResponse =
        get(url("api", "sessions", id, "transcript", query = mapOf("since" to since?.toString())))

    suspend fun startSession(body: NewSessionRequest): Session =
        send(url("api", "sessions"), "POST", json.encodeToString(NewSessionRequest.serializer(), body))

    suspend fun prompt(id: String, text: String): Session =
        send(
            url("api", "sessions", id, "prompt"), "POST",
            json.encodeToString(PromptRequest.serializer(), PromptRequest(text)),
        )

    suspend fun interruptSession(id: String): Session =
        send(url("api", "sessions", id, "interrupt"), "POST")

    suspend fun stopSession(id: String): Session =
        send(url("api", "sessions", id, "stop"), "POST")

    suspend fun forgetSession(id: String) {
        execute(request(url("api", "sessions", id), "DELETE"))
    }

    suspend fun agents(): AgentsResponse = get(url("api", "agents"))

    suspend fun agent(id: String): Agent = get(url("api", "agents", id))

    suspend fun createAgent(input: AgentInput): Agent =
        send(url("api", "agents"), "POST", json.encodeToString(AgentInput.serializer(), input))

    suspend fun updateAgent(id: String, input: AgentInput): Agent =
        send(url("api", "agents", id), "PATCH", json.encodeToString(AgentInput.serializer(), input))

    suspend fun deleteAgent(id: String) {
        execute(request(url("api", "agents", id), "DELETE"))
    }

    suspend fun startAgent(id: String, task: String?): AgentActionResponse =
        send(
            url("api", "agents", id, "start"), "POST",
            json.encodeToString(TaskRequest.serializer(), TaskRequest(task.orEmpty())),
        )

    suspend fun assignTask(id: String, task: String): AgentActionResponse =
        send(
            url("api", "agents", id, "task"), "POST",
            json.encodeToString(TaskRequest.serializer(), TaskRequest(task)),
        )

    suspend fun stopAgent(id: String): StopAgentResponse =
        send(url("api", "agents", id, "stop"), "POST")

    /** SSE endpoint. EventSource-style clients cannot set headers, so the
     *  token goes in the query — the same allowance the web UI uses. */
    fun eventsUrl(sessionId: String? = null): HttpUrl =
        url("api", "events", query = mapOf("token" to server.token, "sessionId" to sessionId))

    internal fun authorizedRequest(url: HttpUrl): Request = request(url)
}

/** Bridges OkHttp's callback API onto coroutines, cancelling the call when the
 *  coroutine is cancelled so a dropped screen does not leak a socket. */
suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) {
            continuation.resume(response)
        }

        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isCancelled) return
            continuation.resumeWithException(ApiException(0, e.message ?: "network error"))
        }
    })
    continuation.invokeOnCancellation { runCatching { cancel() } }
}
