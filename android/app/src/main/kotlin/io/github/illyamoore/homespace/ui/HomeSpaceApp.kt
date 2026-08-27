package io.github.illyamoore.homespace.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.illyamoore.homespace.FileActions
import io.github.illyamoore.homespace.data.ConnectionState
import io.github.illyamoore.homespace.ui.components.StatusBadge
import io.github.illyamoore.homespace.ui.screens.AgentsScreen
import io.github.illyamoore.homespace.ui.screens.AgentsUiState
import io.github.illyamoore.homespace.ui.screens.ConnectScreen
import io.github.illyamoore.homespace.ui.screens.FilesScreen
import io.github.illyamoore.homespace.ui.screens.FilesUiState
import io.github.illyamoore.homespace.ui.screens.OverviewScreen
import io.github.illyamoore.homespace.ui.screens.SessionsScreen
import io.github.illyamoore.homespace.ui.screens.SessionsUiState

enum class Tab(val label: String, val icon: ImageVector) {
    OVERVIEW("Overview", Icons.Default.Home),
    FILES("Content", Icons.Default.Folder),
    SESSIONS("Sessions", Icons.Default.Terminal),
    AGENTS("Agents", Icons.Default.Memory),
}

/**
 * The app shell: connect gate, then a four-tab frame.
 *
 * Tab state is held here rather than in a NavHost because every tab reads the
 * same ViewModel and none of them take arguments — a navigation graph would add
 * a back-stack to reason about for no gain. Each tab keeps its own UI state
 * object so switching away and back does not lose your place.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeSpaceApp(
    viewModel: HomeSpaceViewModel,
    pendingSessionId: String?,
    onPendingSessionHandled: () -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val transcripts by viewModel.transcripts.collectAsStateWithLifecycle()
    val savedServers by viewModel.savedServers.collectAsStateWithLifecycle()
    val restoring by viewModel.restoring.collectAsStateWithLifecycle()
    val toast by viewModel.toasts.collectAsStateWithLifecycle()

    var tab by rememberSaveable { mutableStateOf(Tab.OVERVIEW) }
    val filesUi = remember { FilesUiState() }
    val sessionsUi = remember { SessionsUiState() }
    val agentsUi = remember { AgentsUiState() }
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current

    LaunchedEffect(toast) {
        toast?.let {
            snackbar.showSnackbar(it.text)
            viewModel.clearToast()
        }
    }

    // Tapping a "session finished" notification lands here.
    LaunchedEffect(pendingSessionId, state.isConnected) {
        if (pendingSessionId != null && state.isConnected) {
            sessionsUi.activeId = pendingSessionId
            tab = Tab.SESSIONS
            onPendingSessionHandled()
        }
    }

    if (restoring) {
        Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
        return
    }

    if (!state.isConnected) {
        ConnectScreen(viewModel, savedServers, onConnected = { tab = Tab.OVERVIEW })
        return
    }

    val workingCount = state.sessions.count { it.isBusy }
    val liveAgents = state.agents.count { it.status == "running" || it.status == "working" }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
                title = {
                    Column {
                        Text(
                            state.server?.name ?: "HomeSpace",
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            state.server?.baseUrl.orEmpty(),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                },
                actions = {
                    if (state.connection != ConnectionState.LIVE) {
                        StatusBadge(
                            when (state.connection) {
                                ConnectionState.LIVE -> "running"
                                ConnectionState.CONNECTING -> "working"
                                ConnectionState.DEGRADED -> "error"
                                ConnectionState.DISCONNECTED -> "exited"
                            },
                        )
                    }
                    IconButton(onClick = { viewModel.refresh() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                    IconButton(onClick = { viewModel.disconnect() }) {
                        Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = "Disconnect from this NAS")
                    }
                },
            )
        },
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                Tab.entries.forEach { entry ->
                    val badge = when (entry) {
                        Tab.SESSIONS -> workingCount
                        Tab.AGENTS -> liveAgents
                        else -> 0
                    }
                    NavigationBarItem(
                        selected = tab == entry,
                        onClick = { tab = entry },
                        icon = {
                            if (badge > 0) {
                                BadgedBox(badge = { Badge { Text(badge.toString()) } }) {
                                    Icon(entry.icon, contentDescription = entry.label)
                                }
                            } else {
                                Icon(entry.icon, contentDescription = entry.label)
                            }
                        },
                        label = { Text(entry.label) },
                    )
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (tab) {
                Tab.OVERVIEW -> OverviewScreen(
                    state = state,
                    onBrowseRoot = { rootId ->
                        filesUi.rootId = rootId
                        filesUi.path = ""
                        filesUi.selected = null
                        tab = Tab.FILES
                    },
                    onOpenSession = { id ->
                        sessionsUi.activeId = id
                        tab = Tab.SESSIONS
                    },
                )

                Tab.FILES -> FilesScreen(
                    viewModel = viewModel,
                    state = state,
                    ui = filesUi,
                    onOpenExternally = { url, mime, name, share ->
                        FileActions.open(context, url, mime, name, share)
                    },
                )

                Tab.SESSIONS -> SessionsScreen(
                    viewModel = viewModel,
                    state = state,
                    ui = sessionsUi,
                    transcripts = transcripts,
                )

                Tab.AGENTS -> AgentsScreen(
                    viewModel = viewModel,
                    state = state,
                    ui = agentsUi,
                    onOpenSession = { id ->
                        sessionsUi.activeId = id
                        tab = Tab.SESSIONS
                    },
                )
            }
        }
    }
}
