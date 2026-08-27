package io.github.illyamoore.homespace.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.github.illyamoore.homespace.data.HomeSpaceState
import io.github.illyamoore.homespace.data.RootStatus
import io.github.illyamoore.homespace.data.Session
import io.github.illyamoore.homespace.ui.components.Chip
import io.github.illyamoore.homespace.ui.components.EmptyState
import io.github.illyamoore.homespace.ui.components.HsCard
import io.github.illyamoore.homespace.ui.components.Meter
import io.github.illyamoore.homespace.ui.components.SectionLabel
import io.github.illyamoore.homespace.ui.components.StatusBadge
import io.github.illyamoore.homespace.ui.components.formatBytes
import io.github.illyamoore.homespace.ui.components.formatCost
import io.github.illyamoore.homespace.ui.components.formatRelative
import io.github.illyamoore.homespace.ui.components.formatUptime
import io.github.illyamoore.homespace.ui.theme.LocalHomeSpaceColors
import io.github.illyamoore.homespace.ui.theme.MonoStyle

/** Is the NAS healthy, is Claude Code present, what is running right now. */
@Composable
fun OverviewScreen(
    state: HomeSpaceState,
    onBrowseRoot: (String) -> Unit,
    onOpenSession: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalHomeSpaceColors.current
    val system = state.system

    if (system == null) {
        EmptyState("Waiting for the first snapshot from the NAS…", modifier)
        return
    }

    val live = state.sessions.filter { it.isLive }
    val working = state.sessions.count { it.isBusy }
    val totalCost = state.sessions.sumOf { it.costUsd }

    LazyColumn(
        modifier = modifier.fillMaxWidth(),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Column {
                Text(system.name, style = MaterialTheme.typography.headlineSmall)
                Text(
                    "${system.hostname} · ${system.platform}/${system.arch} · up ${formatUptime(system.uptimeSeconds)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textMuted,
                )
            }
        }

        if (!system.claude.available) {
            item {
                HsCard {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(
                            Icons.Default.Warning,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error,
                            modifier = Modifier.size(18.dp),
                        )
                        Column {
                            Text("Claude Code is not reachable", style = MaterialTheme.typography.titleSmall)
                            Text(
                                "The daemon tried to run \"${system.claude.bin}\". Install Claude Code on the " +
                                    "NAS, or set claude.bin to its full path — sessions cannot start until then.",
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.textMuted,
                            )
                        }
                    }
                }
            }
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(
                    label = "Memory",
                    value = "${system.memory.usedPct}%",
                    note = "${formatBytes(system.memory.totalBytes - system.memory.freeBytes)} of " +
                        formatBytes(system.memory.totalBytes),
                    fraction = system.memory.usedPct / 100f,
                    modifier = Modifier.weight(1f),
                )
                val load = system.loadAverage.firstOrNull() ?: 0.0
                StatTile(
                    label = "Load",
                    value = String.format(java.util.Locale.US, "%.2f", load),
                    note = "${system.cpu.cores} cores",
                    fraction = (load / system.cpu.cores.coerceAtLeast(1)).toFloat(),
                    modifier = Modifier.weight(1f),
                )
            }
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(
                    label = "Sessions",
                    value = live.size.toString(),
                    note = "$working working · limit ${system.claude.maxConcurrentSessions}",
                    fraction = live.size.toFloat() / system.claude.maxConcurrentSessions.coerceAtLeast(1),
                    modifier = Modifier.weight(1f),
                )
                StatTile(
                    label = "Spend",
                    value = formatCost(totalCost),
                    note = "since the daemon started",
                    fraction = null,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        item { SectionLabel("Content roots", Modifier.padding(top = 6.dp)) }

        if (system.roots.isEmpty()) {
            item { EmptyState("No roots configured on this NAS.") }
        } else {
            items(system.roots, key = { it.id }) { root ->
                RootCard(root, onBrowse = { onBrowseRoot(root.id) })
            }
        }

        item { SectionLabel("Active sessions", Modifier.padding(top = 6.dp)) }

        if (live.isEmpty()) {
            item {
                EmptyState(
                    "Nothing running.",
                    detail = "Start one from Sessions, or launch an agent.",
                )
            }
        } else {
            items(live, key = { it.id }) { session ->
                ActiveSessionCard(session, state, onOpen = { onOpenSession(session.id) })
            }
        }

        item { SectionLabel("Claude Code", Modifier.padding(top = 6.dp)) }
        item {
            HsCard {
                KeyValue("Binary", system.claude.bin)
                KeyValue("Version", system.claude.version ?: "unavailable")
                KeyValue("Default model", system.claude.defaultModel ?: "CLI default")
                KeyValue("Permission mode", system.claude.defaultPermissionMode)
            }
        }
    }
}

@Composable
private fun StatTile(
    label: String,
    value: String,
    note: String,
    fraction: Float?,
    modifier: Modifier = Modifier,
) {
    HsCard(modifier) {
        SectionLabel(label)
        Text(
            value,
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(top = 4.dp),
        )
        Text(
            note,
            style = MaterialTheme.typography.bodySmall,
            color = LocalHomeSpaceColors.current.textMuted,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        if (fraction != null) {
            Meter(fraction, Modifier.padding(top = 8.dp))
        }
    }
}

@Composable
private fun RootCard(root: RootStatus, onBrowse: () -> Unit) {
    val colors = LocalHomeSpaceColors.current
    HsCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                Icons.Default.Folder,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(18.dp),
            )
            Text(root.label, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            StatusBadge(if (root.available) "running" else "error")
        }
        Text(
            root.path,
            style = MonoStyle.merge(MaterialTheme.typography.bodySmall),
            color = colors.textMuted,
            modifier = Modifier.padding(top = 4.dp),
        )
        root.error?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.padding(top = 8.dp),
        ) {
            Chip(if (root.workspace) "workspace" else "content")
            Chip(if (root.readOnly) "read-only" else "writable")
        }
        root.disk?.let { disk ->
            if (disk.totalBytes > 0) {
                val used = (disk.totalBytes - disk.freeBytes).toFloat() / disk.totalBytes
                Text(
                    "${formatBytes(disk.freeBytes)} free of ${formatBytes(disk.totalBytes)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textMuted,
                    modifier = Modifier.padding(top = 8.dp),
                )
                Meter(used, Modifier.padding(top = 4.dp))
            }
        }
        if (root.available) {
            TextButton(onClick = onBrowse, modifier = Modifier.padding(top = 4.dp)) { Text("Browse") }
        }
    }
}

@Composable
private fun ActiveSessionCard(session: Session, state: HomeSpaceState, onOpen: () -> Unit) {
    val colors = LocalHomeSpaceColors.current
    val agent = state.agent(session.agentId)
    HsCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Default.Terminal, contentDescription = null, modifier = Modifier.size(18.dp))
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
        TextButton(onClick = onOpen, modifier = Modifier.padding(top = 4.dp)) { Text("Open") }
    }
}

@Composable
private fun KeyValue(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            value,
            style = MonoStyle.merge(MaterialTheme.typography.bodySmall),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}
