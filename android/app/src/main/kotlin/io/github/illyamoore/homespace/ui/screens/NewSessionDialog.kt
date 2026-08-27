package io.github.illyamoore.homespace.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import io.github.illyamoore.homespace.data.HomeSpaceState
import io.github.illyamoore.homespace.data.NewSessionRequest
import io.github.illyamoore.homespace.data.PERMISSION_MODES
import io.github.illyamoore.homespace.data.Session
import io.github.illyamoore.homespace.ui.HomeSpaceViewModel
import io.github.illyamoore.homespace.ui.components.EmptyState

/** Start an ad-hoc session, outside any saved agent. */
@Composable
fun NewSessionDialog(
    viewModel: HomeSpaceViewModel,
    state: HomeSpaceState,
    onDismiss: () -> Unit,
    onStarted: (Session) -> Unit,
) {
    val workspaces = state.system?.roots.orEmpty().filter { it.workspace && it.available }

    if (workspaces.isEmpty()) {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text("Start a session") },
            text = {
                EmptyState(
                    "No writable workspace root is available.",
                    detail = "Mark a root with \"workspace\": true in the server config.",
                )
            },
            confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
        )
        return
    }

    var rootId by remember { mutableStateOf(workspaces.first().id) }
    var path by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var mode by remember {
        mutableStateOf(state.system?.claude?.defaultPermissionMode ?: "manual")
    }
    var task by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Start a session") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
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
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Title") },
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
                    value = task,
                    onValueChange = { task = it },
                    label = { Text("Opening prompt (optional)") },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 88.dp),
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = !busy,
                onClick = {
                    busy = true
                    viewModel.startSession(
                        NewSessionRequest(
                            rootId = rootId,
                            path = path.trim(),
                            title = title.trim().ifBlank { null },
                            model = model.trim().ifBlank { null },
                            permissionMode = mode,
                        ),
                        openingPrompt = task.trim().ifBlank { null },
                    ) { session ->
                        busy = false
                        onStarted(session)
                    }
                },
            ) { Text(if (busy) "Starting…" else "Start") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Cancel") } },
    )
}

fun permissionHelp(mode: String): String = when (mode) {
    "plan" -> "Read-only. Produces a plan and changes nothing."
    "manual" -> "Asks before every tool use — but the app cannot answer those prompts yet."
    "acceptEdits" -> "Auto-approves file edits; other tools still ask."
    "auto" -> "Claude decides when to ask."
    "dontAsk" -> "No prompts; the agent proceeds on its own judgement."
    "bypassPermissions" -> "Every permission check skipped. Only for a workspace you can afford to lose."
    else -> ""
}
