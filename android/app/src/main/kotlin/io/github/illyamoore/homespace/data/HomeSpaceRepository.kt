package io.github.illyamoore.homespace.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Connection state, kept separate from the data so the UI can show "live",
 *  "reconnecting" and "signed out" without inspecting every collection. */
enum class ConnectionState { DISCONNECTED, CONNECTING, LIVE, DEGRADED }

data class HomeSpaceState(
    val server: ServerRef? = null,
    val connection: ConnectionState = ConnectionState.DISCONNECTED,
    val system: SystemSnapshot? = null,
    val sessions: List<Session> = emptyList(),
    val agents: List<Agent> = emptyList(),
    val error: String? = null,
) {
    val isConnected: Boolean get() = server != null
    fun session(id: String?): Session? = sessions.firstOrNull { it.id == id }
    fun agent(id: String?): Agent? = agents.firstOrNull { it.id == id }
}

/**
 * Owns the connection to one daemon: the API client, the SSE subscription, the
 * cached collections, and the transcripts.
 *
 * Screens never call the client directly. They read [state] and [transcripts]
 * and invoke methods here, so there is one place that decides when to refresh
 * and one place that knows whether the stream is healthy.
 */
class HomeSpaceRepository(
    private val store: ServerStore,
    private val scope: CoroutineScope,
    private val onSessionFinished: (Session) -> Unit = {},
) {
    private val _state = MutableStateFlow(HomeSpaceState())
    val state: StateFlow<HomeSpaceState> = _state.asStateFlow()

    private val _transcripts = MutableStateFlow<Map<String, List<TranscriptEntry>>>(emptyMap())
    val transcripts: StateFlow<Map<String, List<TranscriptEntry>>> = _transcripts.asStateFlow()

    var client: HomeSpaceClient? = null
        private set

    private var streamJob: Job? = null
    private var pollJob: Job? = null

    /** Statuses seen on the previous refresh, so a transition into a finished
     *  state fires a notification exactly once. */
    private val lastStatus = mutableMapOf<String, String>()

    // ------------------------------------------------------------ lifecycle

    /** Probe an address and token without disturbing the current connection.
     *  Returns the daemon's own name so the caller can label the record. */
    suspend fun probe(baseUrl: String, token: String): String {
        val normalized = HomeSpaceClient.normalizeBaseUrl(baseUrl)
            ?: throw ApiException(0, "that does not look like an address")
        val probeClient = HomeSpaceClient(
            ServerRef(id = store.idFor(normalized), name = "", baseUrl = normalized, token = token),
        )
        val health = probeClient.health()
        if (health.service != "homespace") {
            throw ApiException(0, "something answered there, but it is not a HomeSpace server")
        }
        // /api/health is unauthenticated, so it proves the address only. One
        // authenticated call is what actually validates the token.
        probeClient.system()
        return health.name.ifBlank { "HomeSpace" }
    }

    suspend fun connect(server: SavedServer, persist: Boolean = true) {
        disconnect(clearActive = false)
        if (persist) store.save(server)

        val ref = server.toRef()
        client = HomeSpaceClient(ref)
        _state.update { it.copy(server = ref, connection = ConnectionState.CONNECTING, error = null) }

        refresh()
        startStream()
        startPolling()
    }

    fun disconnect(clearActive: Boolean = true) {
        streamJob?.cancel()
        pollJob?.cancel()
        streamJob = null
        pollJob = null
        client = null
        lastStatus.clear()
        _transcripts.value = emptyMap()
        _state.value = HomeSpaceState()
        if (clearActive) scope.launch { store.setActive(null) }
    }

    // -------------------------------------------------------------- reading

    suspend fun refresh() {
        val api = client ?: return
        runCatching {
            // Issued together — three sequential round trips is a visible stall
            // on pull-to-refresh over a LAN. Each is caught on its own so one
            // unreachable endpoint does not blank the other two.
            coroutineScope {
                val systemCall = async { runCatching { api.system() }.getOrNull() }
                val sessionsCall = async { runCatching { api.sessions() }.getOrNull() }
                val agentsCall = async { runCatching { api.agents() }.getOrNull() }

                val snapshot = systemCall.await()
                val sessionList = sessionsCall.await()?.sessions ?: _state.value.sessions
                val agentList = agentsCall.await()?.agents ?: _state.value.agents

                notifyFinished(sessionList)

                _state.update {
                    it.copy(
                        system = snapshot ?: it.system,
                        sessions = sessionList,
                        agents = agentList,
                        error = if (snapshot == null && it.system == null) "could not reach the server" else null,
                    )
                }
            }
        }.onFailure { err ->
            _state.update { it.copy(error = err.message) }
        }
    }

    suspend fun loadTranscript(sessionId: String) {
        val api = client ?: return
        runCatching { api.transcript(sessionId) }
            .onSuccess { response ->
                _transcripts.update { it + (sessionId to response.entries) }
                _state.update { current ->
                    current.copy(sessions = current.sessions.map { if (it.id == sessionId) response.session else it })
                }
            }
            .onFailure { err -> _state.update { it.copy(error = err.message) } }
    }

    // -------------------------------------------------------------- actions

    suspend fun startSession(request: NewSessionRequest, openingPrompt: String?): Result<Session> =
        withClient { api ->
            val session = api.startSession(request)
            if (!openingPrompt.isNullOrBlank()) api.prompt(session.id, openingPrompt.trim())
            refresh()
            session
        }

    suspend fun prompt(sessionId: String, text: String): Result<Unit> = withClient { api ->
        api.prompt(sessionId, text)
        // Optimistic: the SSE echo confirms it, but the composer should clear
        // and the badge should flip without waiting for a round trip.
        _state.update { current ->
            current.copy(sessions = current.sessions.map { if (it.id == sessionId) it.copy(status = "working") else it })
        }
    }

    suspend fun interrupt(sessionId: String): Result<Unit> = withClient { it.interruptSession(sessionId); Unit }

    suspend fun stopSession(sessionId: String): Result<Unit> = withClient { api ->
        api.stopSession(sessionId)
        refresh()
    }

    suspend fun forgetSession(sessionId: String): Result<Unit> = withClient { api ->
        api.forgetSession(sessionId)
        _transcripts.update { it - sessionId }
        refresh()
    }

    suspend fun createAgent(input: AgentInput): Result<Agent> = withClient { api ->
        api.createAgent(input).also { refresh() }
    }

    suspend fun updateAgent(id: String, input: AgentInput): Result<Agent> = withClient { api ->
        api.updateAgent(id, input).also { refresh() }
    }

    suspend fun deleteAgent(id: String): Result<Unit> = withClient { api ->
        api.deleteAgent(id)
        refresh()
    }

    suspend fun startAgent(id: String, task: String?): Result<Session> = withClient { api ->
        api.startAgent(id, task).session.also { refresh() }
    }

    suspend fun assignTask(id: String, task: String): Result<Session> = withClient { api ->
        api.assignTask(id, task).session.also { refresh() }
    }

    suspend fun stopAgent(id: String): Result<Unit> = withClient { api ->
        api.stopAgent(id)
        refresh()
    }

    suspend fun listDirectory(rootId: String, path: String): Result<Listing> =
        withClient { it.list(rootId, path) }

    suspend fun readFile(rootId: String, path: String): Result<FileDetail> =
        withClient { it.read(rootId, path) }

    suspend fun searchFiles(rootId: String, query: String): Result<SearchResult> =
        withClient { it.search(rootId, query) }

    fun rawUrl(rootId: String, path: String, download: Boolean = false): String? =
        client?.rawUrl(rootId, path, download)

    fun clearError() = _state.update { it.copy(error = null) }

    private suspend inline fun <T> withClient(block: (HomeSpaceClient) -> T): Result<T> {
        val api = client ?: return Result.failure(ApiException(0, "not connected"))
        return runCatching { block(api) }.onFailure { err ->
            _state.update { it.copy(error = err.message) }
        }
    }

    // --------------------------------------------------------------- stream

    private fun startStream() {
        streamJob?.cancel()
        val api = client ?: return
        streamJob = scope.launch {
            val stream = EventStream(api)
            // OkHttp reconnects within a single subscription; this outer loop
            // covers the case where the flow itself terminates (a 401, or the
            // process being told the token is gone).
            while (isActive) {
                runCatching {
                    stream.events().collect { event -> handle(event) }
                }.onFailure { err ->
                    if (err is ApiException && err.isUnauthorized) {
                        _state.update {
                            it.copy(connection = ConnectionState.DISCONNECTED, error = "token rejected by the server")
                        }
                        return@launch
                    }
                }
                if (!isActive) break
                _state.update { it.copy(connection = ConnectionState.DEGRADED) }
                delay(5_000)
            }
        }
    }

    private suspend fun handle(event: ServerEvent) {
        when (event) {
            is ServerEvent.Connected ->
                _state.update { it.copy(connection = ConnectionState.LIVE) }

            is ServerEvent.Disconnected ->
                _state.update { it.copy(connection = ConnectionState.DEGRADED) }

            is ServerEvent.SessionCreated -> refresh()

            is ServerEvent.SessionStatus -> {
                _state.update { current ->
                    current.copy(
                        sessions = current.sessions.map {
                            if (it.id == event.sessionId) it.copy(status = event.status) else it
                        },
                    )
                }
                // A turn ending changes token counts and cost, which only a
                // full summary carries.
                if (event.status != "working") refresh()
            }

            is ServerEvent.SessionMessage -> appendEntry(event.sessionId, event.entry)

            is ServerEvent.SessionClosed -> refresh()

            is ServerEvent.AgentChanged -> refresh()
        }
    }

    private fun appendEntry(sessionId: String, entry: TranscriptEntry) {
        _transcripts.update { current ->
            val existing = current[sessionId] ?: return@update current
            // The initial fetch and the stream overlap, so the same entry can
            // arrive twice; seq is the daemon's per-session ordering key.
            if (existing.any { it.seq == entry.seq }) current
            else current + (sessionId to (existing + entry).takeLast(MAX_ENTRIES))
        }
    }

    // -------------------------------------------------------------- polling

    /**
     * The stream carries everything, but a stream can die behind a proxy or a
     * dozing radio without the client noticing. A slow poll is the safety net;
     * it is cheap next to keeping a stale dashboard on screen.
     */
    private fun startPolling() {
        pollJob?.cancel()
        pollJob = scope.launch {
            while (isActive) {
                delay(30_000)
                if (client != null) refresh()
            }
        }
    }

    /** Fire the callback once per session that has just stopped working. */
    private fun notifyFinished(sessions: List<Session>) {
        for (session in sessions) {
            val previous = lastStatus[session.id]
            lastStatus[session.id] = session.status
            if (previous == null || previous == session.status) continue
            val finished = previous == "working" && (session.status == "idle" || session.status == "error")
            val died = session.status == "error" || session.status == "exited"
            if (finished || (died && previous == "working")) onSessionFinished(session)
        }
    }

    private companion object {
        const val MAX_ENTRIES = 1500
    }
}
