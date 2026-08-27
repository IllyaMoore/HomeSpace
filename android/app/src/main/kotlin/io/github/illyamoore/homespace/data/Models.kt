package io.github.illyamoore.homespace.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Wire types for the HomeSpace daemon, mirroring docs/api.md.
 *
 * Every field the server may omit carries a default, so a daemon one version
 * ahead or behind cannot crash the app with a MissingFieldException — the
 * client is deliberately lenient about what it accepts.
 */

@Serializable
data class Health(
    val service: String = "",
    val status: String = "",
    val name: String = "",
    val version: String = "",
    val startedAt: String = "",
    val serverTime: String = "",
)

@Serializable
data class SystemSnapshot(
    val name: String = "",
    val hostname: String = "",
    val platform: String = "",
    val release: String = "",
    val arch: String = "",
    val uptimeSeconds: Long = 0,
    val loadAverage: List<Double> = emptyList(),
    val cpu: CpuInfo = CpuInfo(),
    val memory: MemoryInfo = MemoryInfo(),
    val claude: ClaudeInfo = ClaudeInfo(),
    val roots: List<RootStatus> = emptyList(),
    val serverTime: String = "",
)

@Serializable
data class CpuInfo(val model: String = "unknown", val cores: Int = 0)

@Serializable
data class MemoryInfo(
    val totalBytes: Long = 0,
    val freeBytes: Long = 0,
    val usedPct: Int = 0,
)

@Serializable
data class ClaudeInfo(
    val bin: String = "claude",
    val available: Boolean = false,
    val version: String? = null,
    val defaultModel: String? = null,
    val defaultPermissionMode: String = "manual",
    val maxConcurrentSessions: Int = 0,
)

@Serializable
data class DiskInfo(val totalBytes: Long = 0, val freeBytes: Long = 0)

@Serializable
data class RootStatus(
    val id: String = "",
    val label: String = "",
    val path: String = "",
    val workspace: Boolean = false,
    val readOnly: Boolean = true,
    val available: Boolean = false,
    val error: String? = null,
    val disk: DiskInfo? = null,
)

@Serializable
data class RootsResponse(val roots: List<RootRef> = emptyList())

@Serializable
data class RootRef(
    val id: String = "",
    val label: String = "",
    val workspace: Boolean = false,
    val readOnly: Boolean = true,
)

@Serializable
data class Listing(
    val rootId: String = "",
    val path: String = "",
    val parent: String? = null,
    val entries: List<FileEntry> = emptyList(),
    val truncated: Boolean = false,
)

@Serializable
data class FileEntry(
    val name: String = "",
    val path: String = "",
    val kind: String = "binary",
    val sizeBytes: Long = 0,
    val modifiedAt: String = "",
    val symlink: Boolean = false,
) {
    val isDirectory: Boolean get() = kind == "directory"
}

@Serializable
data class FileDetail(
    val rootId: String = "",
    val path: String = "",
    val name: String = "",
    val kind: String = "binary",
    val sizeBytes: Long = 0,
    val modifiedAt: String = "",
    val mimeType: String = "application/octet-stream",
    val content: String? = null,
    val contentTruncated: Boolean = false,
    val reason: String? = null,
)

@Serializable
data class SearchResult(
    val hits: List<SearchHit> = emptyList(),
    val truncated: Boolean = false,
    val scannedDirs: Int = 0,
)

@Serializable
data class SearchHit(
    val rootId: String = "",
    val path: String = "",
    val name: String = "",
    val kind: String = "binary",
    val sizeBytes: Long = 0,
)

@Serializable
data class TokenUsage(
    val inputTokens: Long = 0,
    val outputTokens: Long = 0,
    val cacheReadTokens: Long = 0,
    val cacheCreationTokens: Long = 0,
)

@Serializable
data class SessionsResponse(val sessions: List<Session> = emptyList())

@Serializable
data class Session(
    val id: String = "",
    val claudeSessionId: String = "",
    val agentId: String? = null,
    val title: String = "",
    val status: String = "idle",
    val rootId: String = "",
    val workspacePath: String = "",
    val model: String? = null,
    val permissionMode: String = "manual",
    val createdAt: String = "",
    val lastActivityAt: String = "",
    val turns: Int = 0,
    val entryCount: Int = 0,
    val usage: TokenUsage = TokenUsage(),
    val costUsd: Double = 0.0,
    val exitCode: Int? = null,
    val lastError: String? = null,
) {
    /** True while the process is up and can still take a prompt. */
    val isLive: Boolean get() = status == "idle" || status == "working" || status == "starting"
    val isBusy: Boolean get() = status == "working"
}

@Serializable
data class TranscriptResponse(
    val session: Session = Session(),
    val entries: List<TranscriptEntry> = emptyList(),
)

/**
 * One line of a session transcript. The server emits a tagged union; rather
 * than a sealed hierarchy with a custom deserializer, this is a flat record
 * where `kind` selects which fields are populated. It keeps an unrecognised
 * `kind` from a newer daemon renderable instead of fatal.
 */
@Serializable
data class TranscriptEntry(
    val seq: Long = 0,
    val at: String = "",
    val kind: String = "raw",
    val text: String? = null,
    val level: String? = null,
    val model: String? = null,
    val cwd: String? = null,
    val tools: List<String> = emptyList(),
    val claudeSessionId: String? = null,
    val toolId: String? = null,
    val name: String? = null,
    val input: JsonElement? = null,
    val isError: Boolean = false,
    val subtype: String? = null,
    val durationMs: Long? = null,
    val costUsd: Double? = null,
    val usage: TokenUsage? = null,
    val payload: JsonElement? = null,
)

@Serializable
data class AgentsResponse(val agents: List<Agent> = emptyList())

@Serializable
data class Agent(
    val id: String = "",
    val name: String = "",
    val description: String = "",
    val rootId: String = "",
    val path: String = "",
    val model: String? = null,
    val permissionMode: String = "manual",
    val instructions: String = "",
    val allowedTools: List<String> = emptyList(),
    val disallowedTools: List<String> = emptyList(),
    val createdAt: String = "",
    val updatedAt: String = "",
    val workspacePath: String? = null,
    val workspaceError: String? = null,
    val sessions: List<Session> = emptyList(),
    val activeSessionId: String? = null,
    val status: String = "idle",
)

/** Body for creating or updating an agent. Null fields are omitted by the
 *  encoder, which is what makes a PATCH partial. */
@Serializable
data class AgentInput(
    val name: String? = null,
    val description: String? = null,
    val rootId: String? = null,
    val path: String? = null,
    val model: String? = null,
    val permissionMode: String? = null,
    val instructions: String? = null,
    val allowedTools: List<String>? = null,
    val disallowedTools: List<String>? = null,
)

@Serializable
data class AgentActionResponse(
    val agent: Agent = Agent(),
    val session: Session = Session(),
)

@Serializable
data class StopAgentResponse(val stopped: List<Session> = emptyList())

@Serializable
data class NewSessionRequest(
    val rootId: String,
    val path: String = "",
    val title: String? = null,
    val model: String? = null,
    val permissionMode: String? = null,
    val instructions: String? = null,
)

@Serializable
data class PromptRequest(val text: String)

@Serializable
data class TaskRequest(val task: String)

@Serializable
data class ApiErrorBody(@SerialName("error") val error: String = "unknown error")

val PERMISSION_MODES = listOf(
    "plan", "manual", "acceptEdits", "auto", "dontAsk", "bypassPermissions",
)
