package io.github.illyamoore.homespace.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import io.github.illyamoore.homespace.data.Agent
import io.github.illyamoore.homespace.data.AgentInput
import io.github.illyamoore.homespace.data.HomeSpaceRepository
import io.github.illyamoore.homespace.data.HomeSpaceState
import io.github.illyamoore.homespace.data.NewSessionRequest
import io.github.illyamoore.homespace.data.SavedServer
import io.github.illyamoore.homespace.data.ServerStore
import io.github.illyamoore.homespace.data.Session
import io.github.illyamoore.homespace.data.ThemeChoice
import io.github.illyamoore.homespace.notify.Notifications
import io.github.illyamoore.homespace.work.SessionWatchWorker
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** One-shot message for a snackbar. */
data class Toast(val id: Long, val text: String, val isError: Boolean)

/**
 * Bridges the repository to Compose. Deliberately one ViewModel for the whole
 * app: every screen reads the same connection and the same three collections,
 * and splitting them would mean duplicating the connect/disconnect lifecycle.
 */
class HomeSpaceViewModel(application: Application) : AndroidViewModel(application) {

    private val store = ServerStore(application)

    val repository = HomeSpaceRepository(
        store = store,
        scope = viewModelScope,
        onSessionFinished = ::onSessionFinished,
    )

    val state: StateFlow<HomeSpaceState> = repository.state
    val transcripts = repository.transcripts

    val savedServers = store.servers.stateIn(viewModelScope, SharingStarted.Eagerly, emptyList())
    val theme = store.theme.stateIn(viewModelScope, SharingStarted.Eagerly, ThemeChoice.SYSTEM)

    private val _toasts = MutableStateFlow<Toast?>(null)
    val toasts: StateFlow<Toast?> = _toasts.asStateFlow()

    /** True until the launch reconnect has resolved, so the UI can show a
     *  splash instead of flashing the connect form at a returning user. */
    private val _restoring = MutableStateFlow(true)
    val restoring: StateFlow<Boolean> = _restoring.asStateFlow()

    init {
        viewModelScope.launch {
            val last = store.lastUsed()
            if (last != null) {
                // A saved token can have been rotated on the NAS; failing here
                // just means falling through to the connect screen.
                runCatching { repository.connect(last, persist = false) }
            }
            _restoring.value = false
        }
    }

    // ----------------------------------------------------------- connection

    suspend fun probe(address: String, token: String): Result<String> =
        runCatching { repository.probe(address, token) }

    fun connect(name: String, address: String, token: String, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            val normalized = io.github.illyamoore.homespace.data.HomeSpaceClient.normalizeBaseUrl(address)
            if (normalized == null) {
                toast("that does not look like an address", isError = true)
                onDone(false)
                return@launch
            }
            val server = SavedServer(
                id = store.idFor(normalized),
                name = name,
                baseUrl = normalized,
                token = token,
            )
            runCatching { repository.connect(server) }
                .onSuccess {
                    SessionWatchWorker.enqueue(getApplication<Application>())
                    onDone(true)
                }
                .onFailure {
                    toast(it.message ?: "could not connect", isError = true)
                    onDone(false)
                }
        }
    }

    fun connectSaved(server: SavedServer, onDone: (Boolean) -> Unit) {
        viewModelScope.launch {
            runCatching { repository.connect(server) }
                .onSuccess {
                    SessionWatchWorker.enqueue(getApplication<Application>())
                    onDone(true)
                }
                .onFailure {
                    toast(it.message ?: "could not connect", isError = true)
                    onDone(false)
                }
        }
    }

    fun disconnect() {
        repository.disconnect()
        SessionWatchWorker.cancel(getApplication<Application>())
    }

    fun forgetServer(id: String) {
        viewModelScope.launch { store.forget(id) }
    }

    fun setTheme(choice: ThemeChoice) {
        viewModelScope.launch { store.setTheme(choice) }
    }

    fun refresh() {
        viewModelScope.launch { repository.refresh() }
    }

    // -------------------------------------------------------------- actions

    fun loadTranscript(sessionId: String) {
        viewModelScope.launch { repository.loadTranscript(sessionId) }
    }

    fun startSession(request: NewSessionRequest, openingPrompt: String?, onStarted: (Session) -> Unit) {
        viewModelScope.launch {
            repository.startSession(request, openingPrompt)
                .onSuccess(onStarted)
                .onFailure { toast(it.message ?: "could not start the session", isError = true) }
        }
    }

    fun prompt(sessionId: String, text: String) {
        viewModelScope.launch { repository.prompt(sessionId, text) }
    }

    fun interrupt(sessionId: String) {
        viewModelScope.launch {
            repository.interrupt(sessionId).onSuccess { toast("Interrupt sent") }
        }
    }

    fun stopSession(sessionId: String) {
        viewModelScope.launch { repository.stopSession(sessionId) }
    }

    fun forgetSession(sessionId: String) {
        viewModelScope.launch { repository.forgetSession(sessionId) }
    }

    fun saveAgent(existing: Agent?, input: AgentInput, onSaved: () -> Unit) {
        viewModelScope.launch {
            val result = if (existing == null) {
                repository.createAgent(input)
            } else {
                repository.updateAgent(existing.id, input)
            }
            result
                .onSuccess {
                    toast(if (existing == null) "Agent created" else "Agent updated")
                    onSaved()
                }
                .onFailure { toast(it.message ?: "could not save the agent", isError = true) }
        }
    }

    fun deleteAgent(id: String) {
        viewModelScope.launch {
            repository.deleteAgent(id).onSuccess { toast("Agent deleted") }
        }
    }

    fun startAgent(id: String, task: String?, onStarted: (Session) -> Unit) {
        viewModelScope.launch {
            repository.startAgent(id, task)
                .onSuccess(onStarted)
                .onFailure { toast(it.message ?: "could not start the agent", isError = true) }
        }
    }

    fun assignTask(id: String, task: String, onSent: (Session) -> Unit) {
        viewModelScope.launch {
            repository.assignTask(id, task)
                .onSuccess(onSent)
                .onFailure { toast(it.message ?: "could not send the task", isError = true) }
        }
    }

    fun stopAgent(id: String) {
        viewModelScope.launch { repository.stopAgent(id).onSuccess { toast("Agent stopped") } }
    }

    // --------------------------------------------------------------- toasts

    fun toast(text: String, isError: Boolean = false) {
        _toasts.value = Toast(System.currentTimeMillis(), text, isError)
    }

    fun clearToast() {
        _toasts.value = null
    }

    private fun onSessionFinished(session: Session) {
        Notifications.sessionFinished(getApplication<Application>(), session)
    }

    companion object {
        val Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(
                modelClass: Class<T>,
                extras: androidx.lifecycle.viewmodel.CreationExtras,
            ): T {
                val app = extras[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY] as Application
                return HomeSpaceViewModel(app) as T
            }
        }
    }
}
