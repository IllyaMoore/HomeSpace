package io.github.illyamoore.homespace.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.illyamoore.homespace.data.HomeSpaceState
import io.github.illyamoore.homespace.data.Session
import io.github.illyamoore.homespace.data.TranscriptEntry
import io.github.illyamoore.homespace.ui.HomeSpaceViewModel
import io.github.illyamoore.homespace.ui.components.Chip
import io.github.illyamoore.homespace.ui.components.EmptyState
import io.github.illyamoore.homespace.ui.components.HsCard
import io.github.illyamoore.homespace.ui.components.StatusBadge
import io.github.illyamoore.homespace.ui.components.formatCost
import io.github.illyamoore.homespace.ui.components.formatCount
import io.github.illyamoore.homespace.ui.components.formatDurationMs
import io.github.illyamoore.homespace.ui.components.formatRelative
import io.github.illyamoore.homespace.ui.theme.LocalHomeSpaceColors
import io.github.illyamoore.homespace.ui.theme.MonoStyle
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

class SessionsUiState {
    var activeId by mutableStateOf<String?>(null)
    var showNewSession by mutableStateOf(false)
    /** Drafts survive navigating away and coming back, and survive the
     *  recompositions every SSE frame triggers. */
    val drafts = mutableStateMapOf<String, String>()
}

@Composable
fun SessionsScreen(
    viewModel: HomeSpaceViewModel,
    state: HomeSpaceState,
    ui: SessionsUiState,
    transcripts: Map<String, List<TranscriptEntry>>,
    modifier: Modifier = Modifier,
) {
    val active = state.session(ui.activeId)

    BackHandler(enabled = active != null) { ui.activeId = null }

    LaunchedEffect(ui.activeId) {
        ui.activeId?.let { viewModel.loadTranscript(it) }
    }

    if (active != null) {
        SessionDetail(
            viewModel = viewModel,
            session = active,
            entries = transcripts[active.id].orEmpty(),
            draft = ui.drafts[active.id].orEmpty(),
            onDraftChange = { ui.drafts[active.id] = it },
            onBack = { ui.activeId = null },
            modifier = modifier,
        )
        return
    }

    Scaffold(
        modifier = modifier,
        containerColor = MaterialTheme.colorScheme.background,
        floatingActionButton = {
            ExtendedFloatingActionButton(
                onClick = { ui.showNewSession = true },
                icon = { Icon(Icons.Default.Add, contentDescription = null) },
                text = { Text("New session") },
            )
        },
    ) { padding ->
        if (state.sessions.isEmpty()) {
            EmptyState(
                "No sessions yet.",
                Modifier.padding(padding),
                detail = "Start one to run Claude Code on the NAS.",
            )
        } else {
            LazyColumn(
                Modifier.fillMaxSize().padding(padding),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(state.sessions, key = { it.id }) { session ->
                    SessionCard(session, state, onOpen = { ui.activeId = session.id })
                }
            }
        }
    }

    if (ui.showNewSession) {
        NewSessionDialog(
            viewModel = viewModel,
            state = state,
            onDismiss = { ui.showNewSession = false },
            onStarted = { session ->
                ui.showNewSession = false
                ui.activeId = session.id
            },
        )
    }
}

@Composable
private fun SessionCard(session: Session, state: HomeSpaceState, onOpen: () -> Unit) {
    val colors = LocalHomeSpaceColors.current
    val agent = state.agent(session.agentId)
    HsCard(Modifier.fillMaxWidth().clickable(onClick = onOpen)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                session.title,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            StatusBadge(session.status)
        }
        Text(
            buildString {
                if (agent != null) append("${agent.name} · ")
                append("${session.turns} turns · ${formatRelative(session.lastActivityAt)}")
            },
            style = MaterialTheme.typography.bodySmall,
            color = colors.textMuted,
            modifier = Modifier.padding(top = 4.dp),
        )
        session.lastError?.let {
            Text(
                it.take(140),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
    }
}

@Composable
private fun SessionDetail(
    viewModel: HomeSpaceViewModel,
    session: Session,
    entries: List<TranscriptEntry>,
    draft: String,
    onDraftChange: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalHomeSpaceColors.current
    val listState = rememberLazyListState()

    // Follow the tail as output streams in, but only while the operator is
    // already at the bottom — yanking the view while they read is worse than
    // making them scroll down.
    val atBottom by remember {
        androidx.compose.runtime.derivedStateOf {
            val last = listState.layoutInfo.visibleItemsInfo.lastOrNull()
            last == null || last.index >= listState.layoutInfo.totalItemsCount - 2
        }
    }
    LaunchedEffect(entries.size) {
        if (entries.isNotEmpty() && atBottom) listState.animateScrollToItem(entries.lastIndex)
    }

    Column(modifier.fillMaxSize().imePadding()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to the session list")
            }
            Column(Modifier.weight(1f)) {
                Text(
                    session.title,
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "${session.model ?: "default model"} · ${session.permissionMode}",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            StatusBadge(session.status)
            if (session.isBusy) {
                IconButton(onClick = { viewModel.interrupt(session.id) }) {
                    Icon(Icons.Default.Pause, contentDescription = "Interrupt this turn")
                }
            }
            if (session.isLive) {
                IconButton(onClick = { viewModel.stopSession(session.id) }) {
                    Icon(
                        Icons.Default.Stop,
                        contentDescription = "Stop the session",
                        tint = MaterialTheme.colorScheme.error,
                    )
                }
            } else {
                IconButton(onClick = { viewModel.forgetSession(session.id); onBack() }) {
                    Icon(
                        Icons.Default.Delete,
                        contentDescription = "Forget this session",
                        tint = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
        HorizontalDivider(color = colors.border)

        if (entries.isEmpty()) {
            Box(Modifier.weight(1f), Alignment.Center) { EmptyState("No output yet.") }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(entries, key = { it.seq }) { entry -> TranscriptRow(entry) }
            }
        }

        HorizontalDivider(color = colors.border)
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                "${session.turns} turns · ${formatCount(session.usage.outputTokens)} out · " +
                    formatCost(session.costUsd),
                style = MaterialTheme.typography.labelSmall,
                color = colors.textMuted,
            )
        }

        Row(
            Modifier.fillMaxWidth().padding(10.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = draft,
                onValueChange = onDraftChange,
                placeholder = {
                    Text(if (session.isLive) "Send a prompt…" else "This session has exited.")
                },
                enabled = session.isLive,
                maxLines = 6,
                modifier = Modifier.weight(1f).heightIn(min = 52.dp, max = 160.dp),
            )
            IconButton(
                enabled = session.isLive && draft.isNotBlank(),
                onClick = {
                    viewModel.prompt(session.id, draft.trim())
                    onDraftChange("")
                },
                modifier = Modifier.size(52.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Send,
                    contentDescription = "Send",
                    tint = if (session.isLive && draft.isNotBlank()) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        colors.textMuted
                    },
                )
            }
        }
    }
}

@Composable
private fun TranscriptRow(entry: TranscriptEntry) {
    val colors = LocalHomeSpaceColors.current
    val (label, body, tint) = describe(entry, colors.textMuted, MaterialTheme.colorScheme.error)

    Column(Modifier.fillMaxWidth()) {
        Text(
            label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = colors.textMuted,
        )
        Box(
            Modifier
                .fillMaxWidth()
                .padding(top = 3.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(
                    if (entry.kind == "user") {
                        MaterialTheme.colorScheme.surfaceContainerHigh
                    } else {
                        MaterialTheme.colorScheme.surface
                    },
                )
                .padding(10.dp),
        ) {
            Text(
                body.ifBlank { "(empty)" },
                style = if (entry.kind == "assistant" || entry.kind == "user") {
                    MaterialTheme.typography.bodyMedium
                } else {
                    MonoStyle.merge(MaterialTheme.typography.bodySmall)
                },
                color = tint ?: MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/** Maps one transcript entry onto a label, a body and an optional tint. */
private fun describe(
    entry: TranscriptEntry,
    muted: androidx.compose.ui.graphics.Color,
    error: androidx.compose.ui.graphics.Color,
): Triple<String, String, androidx.compose.ui.graphics.Color?> = when (entry.kind) {
    "user" -> Triple("you", entry.text.orEmpty(), null)
    "assistant" -> Triple("claude", entry.text.orEmpty(), null)
    "thinking" -> Triple("thinking", entry.text.orEmpty(), muted)
    "init" -> Triple(
        "session started",
        listOfNotNull(entry.model, entry.cwd, "${entry.tools.size} tools").joinToString(" · "),
        muted,
    )
    "tool_use" -> Triple("tool · ${entry.name ?: "tool"}", summarizeInput(entry), null)
    "tool_result" -> Triple(
        if (entry.isError) "tool error" else "tool result",
        entry.text.orEmpty().take(2000),
        if (entry.isError) error else muted,
    )
    "notice" -> Triple(entry.level ?: "notice", entry.text.orEmpty(), muted)
    "result" -> Triple(
        "turn complete",
        buildList {
            entry.subtype?.let { add(it) }
            entry.durationMs?.let { add(formatDurationMs(it)) }
            entry.usage?.let { add("${formatCount(it.outputTokens)} out") }
            entry.costUsd?.let { add(formatCost(it)) }
        }.joinToString(" · "),
        if (entry.isError) error else muted,
    )
    else -> Triple("raw", entry.payload?.toString()?.take(800).orEmpty(), muted)
}

/**
 * Tool inputs are arbitrary JSON. Showing the fields that say what the tool is
 * about to do beats a wall of braces.
 */
private fun summarizeInput(entry: TranscriptEntry): String {
    val obj = entry.input as? JsonObject ?: return entry.input?.toString()?.take(600).orEmpty()
    val notable = listOf("command", "file_path", "path", "pattern", "query", "url", "prompt", "description")
    val lines = notable.mapNotNull { key ->
        val value = runCatching { obj[key]?.jsonPrimitive?.content }.getOrNull()
        if (value.isNullOrBlank()) null else "$key: ${value.take(400)}"
    }
    return if (lines.isEmpty()) obj.toString().take(600) else lines.joinToString("\n")
}
