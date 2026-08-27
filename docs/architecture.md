# Architecture

## Shape

One process on the NAS. It serves a JSON API, a static web app, and an SSE
stream, and it supervises child `claude` processes. There is no database, no
message broker, and no runtime dependency beyond Node itself — a NAS is a
constrained, long-uptime box, and every moving part is one more thing to
restart at 3am.

```
src/
├── cli.ts                  serve | init | token | doctor
├── server.ts               node:http wiring, auth gate, static fallback
├── config.ts               load, validate, normalise; the only source of truth
├── core/
│   ├── paths.ts            the root sandbox — see docs/security.md
│   ├── events.ts           in-process pub/sub feeding the SSE route
│   ├── logger.ts
│   └── ids.ts
├── http/
│   ├── router.ts           literal / :param / trailing-* matching
│   ├── auth.ts             constant-time bearer check, CORS decision
│   ├── sse.ts              one client's event stream
│   ├── body.ts             size-capped JSON parsing
│   ├── static.ts           web/ with a containment check
│   └── respond.ts          JSON helpers, HttpError
├── services/
│   ├── system.ts           host snapshot, root health, claude probe
│   ├── files.ts            list, read, stream, search
│   ├── claude-events.ts    stream-json  ->  transcript entries
│   ├── sessions.ts         child process lifecycle
│   └── agents.ts           saved recipes on top of sessions
└── api/routes.ts           the endpoint table
```

## Request path

Every request goes through the same funnel in `server.ts`:

1. CORS decision, then hardening headers.
2. `/api/health` answers unauthenticated — a client must be able to ask "are
   you a HomeSpace daemon?" before it has a token to offer.
3. Everything else under `/api/` requires the bearer token.
4. The router matches, or throws 404 / 405.
5. Anything not under `/api/` is served from `web/`, falling back to the app
   shell for client-side routes.

`PathError` from the sandbox and `HttpError` from handlers both carry a status,
so a handler signals "403, escaped the root" by throwing rather than by
threading an error tuple back up.

## Driving Claude Code

A session is `claude --print --input-format stream-json --output-format
stream-json --verbose`, spawned with `cwd` set to the workspace and its stdio
piped.

This is the programmatic interface, not the interactive TUI, which matters:
no pseudo-terminal is needed, so there is no native `node-pty` dependency to
compile on a NAS, and output arrives as structured JSON instead of ANSI escape
sequences that would have to be parsed back into meaning.

- **Sending** — one JSON object per line on stdin. The CLI queues them.
- **Receiving** — NDJSON on stdout. `NdjsonParser` reassembles lines across
  chunk boundaries, and `toTranscriptEntries` maps envelopes onto the flat
  entries the UI renders.
- **Interrupting** — a `control_request` with subtype `interrupt` on stdin. The
  process survives, so the session can take another prompt afterwards.
- **Stopping** — stdin closed, `SIGTERM`, then `SIGKILL` after a grace period.

### Why the transcript is filtered

The CLI emits far more than the conversation: status pings, thinking-token
counters, rate-limit notices, task summaries, and roughly thirty partial-token
frames per turn. Left alone, a six-line exchange rendered as twenty-two lines
in which the answer was hard to find.

`claude-events.ts` names those envelopes and drops them. Anything **not** on
that list and not understood is still kept, as a `raw` entry — so a future CLI
release that adds an envelope degrades to "shown but unstyled" rather than
"silently lost". Partial-token frames are dropped at the session layer too,
rather than pushed down every open SSE stream, because nothing consumes them.

### Sessions and agents

A **session** is a live process with a transcript. An **agent** is a saved
recipe — workspace, model, permission mode, instructions, tool policy — that
knows how to start one.

The split exists because the two have different lifetimes. Sessions are
disposable and die on restart; agents persist to `agents.json` and are the
thing you actually curate. `AgentStore` holds no process state of its own — it
asks `SessionManager` which sessions carry its id, and derives status from
that, so the two cannot disagree.

Writes to `agents.json` are serialised through a promise chain and land via
temp-file rename, so two concurrent `PATCH`es cannot interleave a
read-modify-write, and a crash mid-write leaves the previous file intact.

## Events

`EventBus` is a `Set` of callbacks. Services publish; the `/api/events` route
is the subscriber that matters, fanning one in-process stream out to every
connected browser.

The browser also polls every 20 seconds. That is deliberate belt-and-braces:
`EventSource` reconnects on its own, but a stream can die behind a proxy in a
way the client does not notice, and a stale dashboard on a NAS is worse than a
slightly chatty one.

## Frontend

`web/` is ES modules served as-is — no bundler, no transpile, no `node_modules`
in the shipped artifact. `dom.js` is a ~60-line `h()` helper and an icon set;
views are functions that build a tree and hand it to `mount()`.

The whole tree is rebuilt on every state change. At this size that is
imperceptible, and it removes a class of bug where the DOM drifts from the
state. The one thing it breaks is the caret: an SSE event landing mid-sentence
would blow away a half-typed prompt. So elements that can hold a caret carry a
`data-focus-key`, `main.js` records which had focus and where the selection
was, and puts it back after the rebuild — and the session composer keeps its
draft in `viewState` rather than in the DOM.

## Deliberate limits

| Limit | Default | Why |
| --- | --- | --- |
| Concurrent sessions | 4 | Each is a full Claude Code process; a NAS has finite RAM. |
| Session idle timeout | 30 min | An abandoned session should not hold memory overnight. |
| Transcript entries | 2000 per session | Bounded heap on a box that runs for months. |
| Text preview | 512 KiB | Past this the browser is the bottleneck; offer a download. |
| Search walk | 20k dirs, depth 12, 200 hits | A share can hold millions of files. Bounded, and it says when it stopped early. |
| Request body | 1 MiB | Large enough for any prompt, small enough to be safe. |

Every one of these reports when it bites rather than silently truncating.
