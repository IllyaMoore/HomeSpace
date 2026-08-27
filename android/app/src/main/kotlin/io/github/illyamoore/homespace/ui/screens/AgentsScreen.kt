package io.github.illyamoore.homespace.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.illyamoore.homespace.data.Agent
import io.github.illyamoore.homespace.data.AgentInput
import io.github.illyamoore.homespace.data.HomeSpaceState
import io.github.illyamoore.homespace.data.PERMISSION_MODES
import io.github.illyamoore.homespace.ui.HomeSpaceViewModel
import io.github.illyamoore.homespace.ui.components.Chip
import io.github.illyamoore.homespace.ui.components.EmptyState
import io.github.illyamoore.homespace.ui.components.HsCard
import io.github.illyamoore.homespace.ui.components.StatusBadge
import io.github.illyamoore.homespace.ui.components.formatRelative
import io.github.illyamoore.homespace.ui.theme.LocalHomeSpaceColors
import io.github.illyamoore.homespace.ui.theme.MonoStyle

class AgentsUiState {
    var editing by mutableStateOf<Agent?>(null)
    var creating by mutableStateOf(false)
    var tasking by mutableStateOf<Agent?>(null)
    var confirmingDelete by mutableStateOf<Agent?>(null)
}

/** Saved workers: a workspace plus a policy, startable in one tap. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AgentsScreen(
    viewModel: HomeSpaceViewModel,
    state: HomeSpaceState,
    ui: AgentsUiState,
    onOpenSession: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalHomeSpaceColors.current

    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { ui.creating = true },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("New agent") },
            )
        },
    ) { padding ->
        if (state.agents.isEmpty()) {
            EmptyState(
                "No agents yet.",
                Modifier.padding(padding),
                detail = "An agent remembers a workspace, a model and a permission mode, " +
                    "so you can put it to work without setting it up each time.",
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize().padding(padding),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(state.agents, key = { it.id }) { agent ->
                    HsCard(Modifier.fillMaxWidth()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(agent.name, style = MaterialTheme.typography.titleSmall)
                                if (agent.description.isNotBlank()) {
                                    Text(
                                        agent.description,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            StatusBadge(agent.status)
                        }

                        Text(
                            agent.workspaceError ?: agent.workspacePath.orEmpty(),
                            style = MonoStyle.merge(MaterialTheme.typography.bodySmall),
                            color = if (agent.workspaceError != null) {
                                MaterialTheme.colorScheme.error
                            } else {
                                colors.textMuted
                            },
                            modifier = Modifier.padding(top = 4.dp),
                        )

                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.padding(top = 8.dp),
                        ) {
                            Chip(agent.model ?: "default model")
                            Chip(agent.permissionMode)
                            if (agent.allowedTools.isNotEmpty()) {
                                Chip("${agent.allowedTools.size} auto-approved")
                            }
                            if (agent.disallowedTools.isNotEmpty()) {
                                Chip("${agent.disallowedTools.size} denied")
                            }
                        }

                        if (agent.sessions.isNotEmpty()) {
                            Text(
                                "${agent.sessions.size} session(s) · last active " +
                                    formatRelative(agent.sessions.first().lastActivityAt),
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textMuted,
                                modifier = Modifier.padding(top = 6.dp),
                            )
                        }

                        val live = agent.status == "running" || agent.status == "working"
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.padding(top = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Button(
                                enabled = agent.workspaceError == null,
                                onClick = { ui.tasking = agent },
                            ) {
                                Icon(
                                    if (live) Icons.Default.Terminal else Icons.Default.PlayArrow,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp),
                                )
                                Text(if (live) "  Assign task" else "  Start")
                            }
                            agent.activeSessionId?.let { sessionId ->
                                OutlinedButton(onClick = { onOpenSession(sessionId) }) { Text("Open") }
                            }
                            if (live) {
                                OutlinedButton(onClick = { viewModel.stopAgent(agent.id) }) {
                                    Icon(Icons.Default.Stop, contentDescription = null, modifier = Modifier.size(16.dp))
                                    Text("  Stop")
                                }
                            }
                            IconButton(onClick = { ui.editing = agent }) {
                                Icon(Icons.Default.Edit, contentDescription = "Edit ${agent.name}")
                            }
                            IconButton(onClick = { ui.confirmingDelete = agent }) {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = "Delete ${agent.name}",
                                    tint = MaterialTheme.colorScheme.error,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    if (ui.creating || ui.editing != null) {
        AgentFormDialog(
            viewModel = viewModel,
            state = state,
            agent = ui.editing,
            onDismiss = { ui.creating = false; ui.editing = null },
        )
    }

    ui.tasking?.let { agent ->
        TaskDialog(
            viewModel = viewModel,
            agent = agent,
            onDismiss = { ui.tasking = null },
            onStarted = { session ->
                ui.tasking = null
                onOpenSession(session.id)
            },
        )
    }

    ui.confirmingDelete?.let { agent ->
        AlertDialog(
            onDismissRequest = { ui.confirmingDelete = null },
            title = { Text("Delete ${agent.name}?") },
            text = { Text("The agent's saved configuration is removed. Its sessions are not affected.") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.deleteAgent(agent.id)
                    ui.confirmingDelete = null
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { ui.confirmingDelete = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun AgentFormDialog(
    viewModel: HomeSpaceViewModel,
    state: HomeSpaceState,
    agent: Agent?,
    onDismiss: () -> Unit,
) {
    val workspaces = state.system?.roots.orEmpty().filter { it.workspace }

    if (workspaces.isEmpty()) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("New agent") },
            text = {
                EmptyState(
                    "No workspace root is configured.",
                    detail = "Mark one root with \"workspace\": true in the server config and restart the daemon.",
                )
            },
            confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
        )
        return
    }

    var name by remember { mutableStateOf(agent?.name.orEmpty()) }
    var description by remember { mutableStateOf(agent?.description.orEmpty()) }
    var rootId by remember { mutableStateOf(agent?.rootId ?: workspaces.first().id) }
    var path by remember { mutableStateOf(agent?.path.orEmpty()) }
    var model by remember { mutableStateOf(agent?.model.orEmpty()) }
    var mode by remember {
        mutableStateOf(agent?.permissionMode ?: state.system?.claude?.defaultPermissionMode ?: "manual")
    }
    var instructions by remember { mutableStateOf(agent?.instructions.orEmpty()) }
    var allowed by remember { mutableStateOf(agent?.allowedTools.orEmpty().joinToString(", ")) }
    var denied by remember { mutableStateOf(agent?.disallowedTools.orEmpty().joinToString(", ")) }
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (agent == null) "New agent" else "Edit ${agent.name}") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Description") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                LabeledPicker(
                    label = "Workspace root",
                    options = workspaces.map { it.id to "${it.label} — ${it.path}" },
                    selected = rootId,
                    onSelect = { rootId = it },
                )
                OutlinedTextField(
                    value = path,
                    onValueChange = { path = it },
                    label = { Text("Subdirectory (optional)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = model,
                    onValueChange = { model = it },
                    label = { Text("Model") },
                    placeholder = { Text(state.system?.claude?.defaultModel ?: "CLI default") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                LabeledPicker(
                    label = "Permission mode",
                    options = PERMISSION_MODES.map { it to it },
                    selected = mode,
                    onSelect = { mode = it },
                    help = permissionHelp(mode),
                )
                OutlinedTextField(
                    value = instructions,
                    onValueChange = { instructions = it },
                    label = { Text("Instructions") },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 80.dp),
                )
                OutlinedTextField(
                    value = allowed,
                    onValueChange = { allowed = it },
                    label = { Text("Auto-approved tools") },
                    placeholder = { Text("Read, Grep") },
                    supportingText = {
                        Text("Run without a prompt. This is not a restriction — it does not stop other tools.")
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = denied,
                    onValueChange = { denied = it },
                    label = { Text("Denied tools") },
                    placeholder = { Text("WebFetch") },
                    supportingText = { Text("The field that actually constrains the agent.") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && name.isNotBlank(),
                onClick = {
                    busy = true
                    viewModel.saveAgent(
                        existing = agent,
                        input = AgentInput(
                            name = name.trim(),
                            description = description.trim(),
                            rootId = rootId,
                            path = path.trim(),
                            model = model.trim().ifBlank { null },
                            permissionMode = mode,
                            instructions = instructions.trim(),
                            allowedTools = splitList(allowed),
                            disallowedTools = splitList(denied),
                        ),
                    ) {
                        busy = false
                        onDismiss()
                    }
                },
            ) { Text(if (agent == null) "Create" else "Save") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
private fun TaskDialog(
    viewModel: HomeSpaceViewModel,
    agent: Agent,
    onDismiss: () -> Unit,
    onStarted: (io.github.illyamoore.homespace.data.Session) -> Unit,
) {
    val running = agent.status == "running" || agent.status == "working"
    var task by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (running) "Assign a task to ${agent.name}" else "Start ${agent.name}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    if (running) {
                        "Goes to the agent's running session."
                    } else {
                        "Starts a Claude Code session in ${agent.workspacePath ?: "its workspace"}." +
                            if (agent.permissionMode == "bypassPermissions") {
                                " Every permission check is skipped."
                            } else {
                                ""
                            }
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = LocalHomeSpaceColors.current.textMuted,
                )
                OutlinedTextField(
                    value = task,
                    onValueChange = { task = it },
                    label = { Text("Task") },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 110.dp),
                )
                if (!running) {
                    Text(
                        "Optional — you can start the agent and prompt it afterwards.",
                        style = MaterialTheme.typography.bodySmall,
                        color = LocalHomeSpaceColors.current.textMuted,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy && (running.not() || task.isNotBlank()),
                onClick = {
                    busy = true
                    if (running) {
                        viewModel.assignTask(agent.id, task.trim()) { busy = false; onStarted(it) }
                    } else {
                        viewModel.startAgent(agent.id, task.trim().ifBlank { null }) { busy = false; onStarted(it) }
                    }
                },
            ) { Text(if (running) "Send" else "Start") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Cancel") } },
    )
}

private fun splitList(value: String): List<String> =
    value.split(',').map { it.trim() }.filter { it.isNotEmpty() }
