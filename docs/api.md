# HTTP API

Base URL is wherever the daemon listens, e.g. `http://nas.local:7333`.

Every route under `/api/` except `/api/health` requires the token:

```
Authorization: Bearer <token>
```

Where a header is impossible — `EventSource`, `<img>`, `<video>` — pass
`?token=<token>` instead.

Errors are always `{"error": "message"}` with a meaningful status: `400`
malformed, `401` bad token, `403` outside a root or forbidden by policy, `404`
unknown, `405` wrong method, `409` wrong state, `413` body too large, `429`
session limit, `500` unexpected.

---

## Health and system

### `GET /api/health` — unauthenticated

```json
{
  "service": "homespace",
  "status": "ok",
  "name": "HomeSpace on nas",
  "version": "0.1.0",
  "startedAt": "2026-08-27T20:29:56.230Z",
  "serverTime": "2026-08-27T20:30:04.100Z"
}
```

Deliberately reveals nothing about the filesystem — it exists so a client can
confirm it found a HomeSpace daemon before it has a token.

### `GET /api/system`

Host snapshot, root health, and whether Claude Code is reachable.

```json
{
  "name": "HomeSpace on nas",
  "hostname": "nas", "platform": "linux", "release": "6.1.0", "arch": "x64",
  "uptimeSeconds": 918273,
  "loadAverage": [0.42, 0.51, 0.48],
  "cpu": { "model": "Intel(R) Celeron(R) J4125", "cores": 4 },
  "memory": { "totalBytes": 8589934592, "freeBytes": 3221225472, "usedPct": 62 },
  "claude": {
    "bin": "claude", "available": true, "version": "2.1.247 (Claude Code)",
    "defaultModel": null, "defaultPermissionMode": "manual",
    "maxConcurrentSessions": 4
  },
  "roots": [
    {
      "id": "media", "label": "Media", "path": "/volume1/media",
      "workspace": false, "readOnly": true,
      "available": true, "error": null,
      "disk": { "totalBytes": 8001563222016, "freeBytes": 2140156456960 }
    }
  ],
  "serverTime": "2026-08-27T20:30:04.100Z"
}
```

`available: false` with an `error` means the share is not mounted or not
readable — the common NAS failure, surfaced rather than reported as an empty
directory.

---

## Files

Paths are relative to a root and appended to the URL. An empty tail means the
root itself. Every path goes through the sandbox in
[Security](security.md#the-root-sandbox).

### `GET /api/files`

The roots this daemon exposes: `{ "roots": [{ id, label, workspace, readOnly }] }`

### `GET /api/files/:rootId/list/<path>`

Query: `hidden=1` to include dotfiles, `limit=<n>` (default 1000, max 5000).

```json
{
  "rootId": "media", "path": "movies", "parent": "",
  "entries": [
    { "name": "2024", "path": "movies/2024", "kind": "directory",
      "sizeBytes": 0, "modifiedAt": "2026-08-01T10:00:00.000Z", "symlink": false },
    { "name": "clip.mkv", "path": "movies/clip.mkv", "kind": "video",
      "sizeBytes": 1073741824, "modifiedAt": "2026-08-02T10:00:00.000Z", "symlink": false }
  ],
  "truncated": false
}
```

`parent` is `null` at the root. `kind` is one of `directory`, `text`, `image`,
`video`, `audio`, `pdf`, `archive`, `binary`. Directories sort first, then
case-insensitive by name.

### `GET /api/files/:rootId/read/<path>`

Metadata, plus inline content for text files under 512 KiB.

```json
{
  "rootId": "documents", "path": "notes/todo.md", "name": "todo.md",
  "kind": "text", "sizeBytes": 214,
  "modifiedAt": "2026-08-20T09:12:00.000Z",
  "mimeType": "text/markdown; charset=utf-8",
  "content": "# Todo\n- ...\n",
  "contentTruncated": false,
  "reason": null
}
```

`content` is `null` for anything not inline-able, and `reason` says why:
too large, wrong kind, or — for a file with a text extension that turns out to
hold binary data — `"file contains binary data"`, with `kind` corrected to
`binary`.

### `GET /api/files/:rootId/raw/<path>`

Streams the bytes. Supports `Range` (`206` with `Content-Range`, `416` when
unsatisfiable), so video and audio seek without a full download. Add
`?download=1` for `Content-Disposition: attachment`.

### `GET /api/files/:rootId/search?q=<query>`

Breadth-first filename search. `q` must be at least 2 characters.

```json
{
  "hits": [{ "rootId": "media", "path": "movies/2024/clip.mkv",
             "name": "clip.mkv", "kind": "video", "sizeBytes": 1073741824 }],
  "truncated": false,
  "scannedDirs": 412
}
```

Bounded at 200 hits, 20 000 directories and depth 12. `truncated: true` means
it stopped early — the result is a sample, not the answer. Symlinked
directories are not descended into, so the walk cannot loop.

---

## Sessions

A session is a live `claude` process on the NAS.

### `GET /api/sessions`

`{ "sessions": [ SessionSummary, … ] }`, most recently active first.

```json
{
  "id": "daf0effe-8f84-4174-960f-2dd2dcbbfff6",
  "claudeSessionId": "69cfd56c-0106-47bf-ac00-5b7f49637b14",
  "agentId": null,
  "title": "media cleanup",
  "status": "idle",
  "rootId": "code", "workspacePath": "/volume1/code",
  "model": "claude-sonnet-5", "permissionMode": "plan",
  "createdAt": "…", "lastActivityAt": "…",
  "turns": 1, "entryCount": 6,
  "usage": { "inputTokens": 4, "outputTokens": 536,
             "cacheReadTokens": 45071, "cacheCreationTokens": 45645 },
  "costUsd": 0.1979, "exitCode": null, "lastError": null
}
```

`status` is `starting`, `idle` (up, awaiting a prompt), `working` (mid-turn),
`exited`, or `error`. `claudeSessionId` is the CLI's own id — `claude --resume
<id>` from a shell on the NAS picks the conversation up.

### `POST /api/sessions` → `201`

```json
{ "rootId": "code", "path": "myproject", "title": "refactor",
  "model": "claude-sonnet-5", "permissionMode": "acceptEdits",
  "instructions": "Prefer small commits." }
```

Only `rootId` is required, and it must name a root with `workspace: true`
(otherwise `403`). `429` when the concurrent-session limit is reached.

### `GET /api/sessions/:id`

One `SessionSummary`.

### `GET /api/sessions/:id/transcript`

Query: `since=<seq>` for entries after a sequence number, `limit=<n>` (default
500, max 5000).

```json
{ "session": { … }, "entries": [ … ] }
```

Every entry has `seq`, `at` and `kind`:

| `kind` | Fields |
| --- | --- |
| `init` | `model`, `tools[]`, `cwd`, `claudeSessionId` |
| `user` | `text` |
| `assistant` | `text` |
| `thinking` | `text` |
| `tool_use` | `toolId`, `name`, `input` |
| `tool_result` | `toolId`, `isError`, `text` |
| `result` | `subtype`, `isError`, `durationMs`, `costUsd`, `usage`, `text` |
| `notice` | `level`, `text` — from the daemon, not the model |
| `raw` | `payload` — an envelope this version does not recognise |

CLI telemetry (status pings, token counters, rate-limit notices, partial-token
frames) is filtered out; see
[Architecture](architecture.md#why-the-transcript-is-filtered).

### `POST /api/sessions/:id/prompt` → `202`

`{ "text": "…" }`. `409` if the session is not running.

### `POST /api/sessions/:id/interrupt` → `202`

Abandons the current turn. The process survives and can take another prompt.

### `POST /api/sessions/:id/stop` → `200`

`SIGTERM`, then `SIGKILL` after a grace period. Returns the final summary. The
transcript stays readable.

### `DELETE /api/sessions/:id` → `204`

Forgets an exited session. `409` while it is still running.

---

## Agents

An agent is a saved recipe that knows how to start a session.

### `GET /api/agents`

`{ "agents": [ AgentView, … ] }`

```json
{
  "id": "agent_ad538281de64",
  "name": "Repo tidier", "description": "keeps the code root tidy",
  "rootId": "code", "path": "",
  "model": null, "permissionMode": "plan",
  "instructions": "Be concise.",
  "allowedTools": ["Read", "Grep"], "disallowedTools": [],
  "createdAt": "…", "updatedAt": "…",
  "workspacePath": "/volume1/code", "workspaceError": null,
  "sessions": [ … ], "activeSessionId": null,
  "status": "idle"
}
```

`status` is derived from the agent's sessions: `idle`, `running`, `working`, or
`error`.

Note that `allowedTools` maps to `--allowed-tools`, which auto-approves rather
than restricts. `disallowedTools` is the field that actually constrains the
agent — see [Security](security.md#auto-approved-is-not-the-same-as-allowed).

### `GET /api/agents/:id`

One `AgentView`. `404` if it does not exist.

### `POST /api/agents` → `201`

`name` and `rootId` are required. `rootId` must be a workspace root, `path`
must resolve inside it, and `bypassPermissions` is refused on a read-only root.

### `PATCH /api/agents/:id` → `200`

Partial update; omitted fields keep their value.

### `DELETE /api/agents/:id` → `204`

`409` if the agent has running sessions.

### `POST /api/agents/:id/start` → `201`

`{ "task": "optional opening prompt" }` → `{ "agent": AgentView, "session": SessionSummary }`

### `POST /api/agents/:id/task` → `202`

`{ "task": "…" }` — routes to the agent's live session, starting one if none is
up. This is the endpoint to use when you do not want to think about lifecycle.

### `POST /api/agents/:id/stop` → `200`

`{ "stopped": [ SessionSummary, … ] }`

---

## Events

### `GET /api/events` — Server-Sent Events

Query: `token=<token>` (required — `EventSource` cannot send headers),
`sessionId=<id>` to filter to one session.

The stream opens with `event: hello`, then:

| Event | Payload |
| --- | --- |
| `session.created` | `{ sessionId, agentId, at }` |
| `session.status` | `{ sessionId, status, at }` |
| `session.message` | `{ sessionId, entry, at }` — one transcript entry |
| `session.closed` | `{ sessionId, code, at }` |
| `agent.created` / `agent.updated` / `agent.deleted` | `{ agentId, at }` |

A `: ping` comment every 25 seconds keeps proxies from culling the connection.
Reconnection is `EventSource`'s own job; the reference UI also polls every 20
seconds in case a stream dies silently behind a proxy.
