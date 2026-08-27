package io.github.illyamoore.homespace.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.AudioFile
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import io.github.illyamoore.homespace.data.FileDetail
import io.github.illyamoore.homespace.data.FileEntry
import io.github.illyamoore.homespace.data.HomeSpaceState
import io.github.illyamoore.homespace.data.Listing
import io.github.illyamoore.homespace.data.SearchResult
import io.github.illyamoore.homespace.ui.HomeSpaceViewModel
import io.github.illyamoore.homespace.ui.components.EmptyState
import io.github.illyamoore.homespace.ui.components.MediaPreview
import io.github.illyamoore.homespace.ui.components.formatBytes
import io.github.illyamoore.homespace.ui.components.formatRelative
import io.github.illyamoore.homespace.ui.theme.LocalHomeSpaceColors
import io.github.illyamoore.homespace.ui.theme.MonoStyle
import kotlinx.coroutines.delay

/** Browser state, hoisted so navigating away and back keeps your place. */
class FilesUiState {
    var rootId by mutableStateOf<String?>(null)
    var path by mutableStateOf("")
    var listing by mutableStateOf<Listing?>(null)
    var loading by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var selected by mutableStateOf<FileDetail?>(null)
    var previewLoading by mutableStateOf(false)
    var pendingOpen by mutableStateOf<Pair<String, String>?>(null)
    var query by mutableStateOf("")
    var searching by mutableStateOf(false)
    var results by mutableStateOf<SearchResult?>(null)
    var rootMenuOpen by mutableStateOf(false)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilesScreen(
    viewModel: HomeSpaceViewModel,
    state: HomeSpaceState,
    ui: FilesUiState,
    onOpenExternally: (url: String, mimeType: String, name: String, share: Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalHomeSpaceColors.current
    val roots = state.system?.roots.orEmpty().filter { it.available }

    // Pick a root the first time the screen is shown, or if the configured
    // roots changed under us.
    LaunchedEffect(roots.map { it.id }) {
        if (roots.isEmpty()) return@LaunchedEffect
        if (ui.rootId == null || roots.none { it.id == ui.rootId }) {
            ui.rootId = roots.first().id
            ui.path = ""
        }
    }

    val activeRoot = roots.firstOrNull { it.id == ui.rootId }

    suspend fun load(rootId: String, path: String) {
        ui.loading = true
        ui.error = null
        viewModel.repository.listDirectory(rootId, path)
            .onSuccess { ui.listing = it; ui.path = it.path }
            .onFailure { ui.listing = null; ui.error = it.message ?: "could not read that directory" }
        ui.loading = false
    }

    LaunchedEffect(ui.rootId, ui.path) {
        val rootId = ui.rootId ?: return@LaunchedEffect
        if (ui.query.isBlank()) load(rootId, ui.path)
    }

    // Debounced: a NAS search is a directory walk, not an index lookup, so
    // firing per keystroke would hammer the box.
    LaunchedEffect(ui.query, ui.rootId) {
        val rootId = ui.rootId ?: return@LaunchedEffect
        val q = ui.query.trim()
        if (q.length < 2) {
            ui.results = null
            ui.searching = false
            return@LaunchedEffect
        }
        ui.searching = true
        delay(350)
        viewModel.repository.searchFiles(rootId, q)
            .onSuccess { ui.results = it }
            .onFailure { ui.results = SearchResult() }
        ui.searching = false
    }

    LaunchedEffect(ui.pendingOpen) {
        val (rootId, path) = ui.pendingOpen ?: return@LaunchedEffect
        viewModel.repository.readFile(rootId, path)
            .onSuccess { ui.selected = it }
            .onFailure { ui.selected = ui.selected?.copy(reason = it.message ?: "could not read that file") }
        ui.previewLoading = false
        ui.pendingOpen = null
    }

    // Back closes the preview, then walks up the tree, before leaving the tab.
    BackHandler(enabled = ui.selected != null || ui.path.isNotEmpty() || ui.query.isNotBlank()) {
        when {
            ui.selected != null -> ui.selected = null
            ui.query.isNotBlank() -> ui.query = ""
            else -> ui.path = ui.listing?.parent ?: ""
        }
    }

    if (roots.isEmpty()) {
        EmptyState("No content roots are available on this NAS.", modifier)
        return
    }

    val detail = ui.selected
    if (detail != null) {
        FilePreview(
            detail = detail,
            rawUrl = viewModel.repository.rawUrl(detail.rootId, detail.path),
            downloadUrl = viewModel.repository.rawUrl(detail.rootId, detail.path, download = true),
            loading = ui.previewLoading,
            onClose = { ui.selected = null },
            onOpenExternally = onOpenExternally,
            modifier = modifier,
        )
        return
    }

    Column(modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box {
                TextButton(onClick = { ui.rootMenuOpen = true }) {
                    Icon(Icons.Default.Folder, contentDescription = null, modifier = Modifier.size(16.dp))
                    Text(
                        "  ${activeRoot?.label ?: "root"}",
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                DropdownMenu(expanded = ui.rootMenuOpen, onDismissRequest = { ui.rootMenuOpen = false }) {
                    roots.forEach { root ->
                        DropdownMenuItem(
                            text = { Text(root.label) },
                            onClick = {
                                ui.rootMenuOpen = false
                                ui.rootId = root.id
                                ui.path = ""
                                ui.query = ""
                                ui.selected = null
                            },
                        )
                    }
                }
            }

            OutlinedTextField(
                value = ui.query,
                onValueChange = { ui.query = it },
                placeholder = { Text("Search filenames") },
                singleLine = true,
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                modifier = Modifier.weight(1f),
            )
        }

        if (ui.query.isBlank()) {
            Breadcrumbs(
                rootLabel = activeRoot?.label ?: "root",
                path = ui.path,
                onNavigate = { ui.path = it },
            )
        }

        HorizontalDivider(color = colors.border)

        when {
            ui.query.isNotBlank() -> SearchResults(
                searching = ui.searching,
                results = ui.results,
                onOpen = { hit ->
                    if (hit.kind == "directory") {
                        ui.query = ""
                        ui.path = hit.path
                    } else {
                        openFile(ui, hit.rootId, hit.path)
                    }
                },
            )

            ui.loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }

            ui.error != null -> EmptyState(ui.error!!)

            else -> {
                val listing = ui.listing
                if (listing == null || (listing.entries.isEmpty() && listing.parent == null)) {
                    EmptyState("This directory is empty.")
                } else {
                    LazyColumn(Modifier.fillMaxSize()) {
                        if (listing.parent != null) {
                            item {
                                FileRow(
                                    icon = Icons.AutoMirrored.Filled.ArrowBack,
                                    name = "..",
                                    meta = null,
                                    isDirectory = true,
                                    onClick = { ui.path = listing.parent!! },
                                )
                            }
                        }
                        items(listing.entries, key = { it.path }) { entry ->
                            FileRow(
                                icon = iconFor(entry.kind),
                                name = entry.name,
                                meta = if (entry.isDirectory) {
                                    formatRelative(entry.modifiedAt)
                                } else {
                                    "${formatBytes(entry.sizeBytes)} · ${formatRelative(entry.modifiedAt)}"
                                },
                                isDirectory = entry.isDirectory,
                                onClick = {
                                    if (entry.isDirectory) {
                                        ui.path = entry.path
                                    } else {
                                        openFile(ui, listing.rootId, entry.path)
                                    }
                                },
                            )
                        }
                        if (listing.truncated) {
                            item {
                                Text(
                                    "Listing truncated — this directory has more entries than the limit.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.textMuted,
                                    modifier = Modifier.padding(16.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Shows the preview shell immediately; the effect below fetches the detail. */
private fun openFile(ui: FilesUiState, rootId: String, path: String) {
    ui.previewLoading = true
    ui.selected = FileDetail(rootId = rootId, path = path, name = path.substringAfterLast('/'))
    ui.pendingOpen = rootId to path
}

@Composable
private fun Breadcrumbs(rootLabel: String, path: String, onNavigate: (String) -> Unit) {
    val parts = path.split('/').filter { it.isNotEmpty() }
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TextButton(onClick = { onNavigate("") }) { Text(rootLabel) }
        var accumulated = ""
        parts.forEachIndexed { index, part ->
            accumulated = if (accumulated.isEmpty()) part else "$accumulated/$part"
            val target = accumulated
            Text("/", color = LocalHomeSpaceColors.current.textMuted)
            if (index == parts.lastIndex) {
                Text(part, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(horizontal = 8.dp))
            } else {
                TextButton(onClick = { onNavigate(target) }) { Text(part) }
            }
        }
    }
}

@Composable
private fun SearchResults(searching: Boolean, results: SearchResult?, onOpen: (io.github.illyamoore.homespace.data.SearchHit) -> Unit) {
    if (searching && results == null) {
        Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
        return
    }
    val hits = results?.hits.orEmpty()
    if (hits.isEmpty()) {
        EmptyState("No matching files.")
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(hits, key = { "${it.rootId}/${it.path}" }) { hit ->
            FileRow(
                icon = iconFor(hit.kind),
                name = hit.name,
                meta = hit.path,
                isDirectory = hit.kind == "directory",
                onClick = { onOpen(hit) },
            )
        }
        if (results?.truncated == true) {
            item {
                Text(
                    "Showing the first ${hits.size} matches — narrow the query for more.",
                    style = MaterialTheme.typography.bodySmall,
                    color = LocalHomeSpaceColors.current.textMuted,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }
    }
}

@Composable
private fun FileRow(
    icon: ImageVector,
    name: String,
    meta: String?,
    isDirectory: Boolean,
    onClick: () -> Unit,
) {
    val colors = LocalHomeSpaceColors.current
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(
            icon,
            contentDescription = null,
            tint = if (isDirectory) MaterialTheme.colorScheme.primary else colors.textMuted,
            modifier = Modifier.size(20.dp),
        )
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (meta != null) {
                Text(
                    meta,
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun FilePreview(
    detail: FileDetail,
    rawUrl: String?,
    downloadUrl: String?,
    loading: Boolean,
    onClose: () -> Unit,
    onOpenExternally: (String, String, String, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalHomeSpaceColors.current
    Column(modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onClose) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back to the listing")
            }
            Column(Modifier.weight(1f)) {
                Text(detail.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "${detail.kind} · ${formatBytes(detail.sizeBytes)} · ${formatRelative(detail.modifiedAt)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.textMuted,
                )
            }
            if (rawUrl != null) {
                IconButton(onClick = { onOpenExternally(rawUrl, detail.mimeType, detail.name, true) }) {
                    Icon(Icons.Default.Share, contentDescription = "Share")
                }
            }
            if (downloadUrl != null) {
                IconButton(onClick = { onOpenExternally(downloadUrl, detail.mimeType, detail.name, false) }) {
                    Icon(Icons.Default.Download, contentDescription = "Download")
                }
            }
        }
        HorizontalDivider(color = colors.border)

        Box(Modifier.fillMaxSize()) {
            when {
                loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }

                detail.content != null -> Text(
                    detail.content,
                    style = MonoStyle.merge(MaterialTheme.typography.bodySmall),
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .horizontalScroll(rememberScrollState())
                        .padding(14.dp),
                )

                detail.kind == "image" && rawUrl != null -> AsyncImage(
                    model = rawUrl,
                    contentDescription = detail.name,
                    modifier = Modifier.fillMaxSize().padding(8.dp),
                )

                (detail.kind == "video" || detail.kind == "audio") && rawUrl != null ->
                    MediaPreview(rawUrl, isAudio = detail.kind == "audio", modifier = Modifier.fillMaxSize())

                else -> Column(
                    Modifier.fillMaxSize().padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        detail.reason ?: "No inline preview for this file type.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textMuted,
                    )
                    if (rawUrl != null) {
                        TextButton(onClick = { onOpenExternally(rawUrl, detail.mimeType, detail.name, true) }) {
                            Text("Open with another app")
                        }
                    }
                }
            }
        }
    }
}

private fun iconFor(kind: String): ImageVector = when (kind) {
    "directory" -> Icons.Default.Folder
    "image" -> Icons.Default.Image
    "video" -> Icons.Default.Videocam
    "audio" -> Icons.Default.AudioFile
    "pdf" -> Icons.Default.PictureAsPdf
    "archive" -> Icons.Default.Archive
    else -> Icons.AutoMirrored.Filled.InsertDriveFile
}
