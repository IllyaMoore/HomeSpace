# HomeSpace

A control surface for your NAS. One daemon on the box, one web app in the
browser: browse the content on your shares, open Claude Code sessions **on the
NAS itself**, and run saved code agents against your repositories.

The UI follows the visual language of the
[OpenClaw dashboard](https://github.com/IllyaMoore/openclaw-dashboard-plugin) —
warm near-black surfaces, a single red accent, a strict text ramp — but the
code here is its own thing: a dependency-free Node daemon and a no-build
frontend, sized for a box whose day job is serving files.

```
┌── browser ────────────────┐        ┌── NAS ─────────────────────────────┐
│  web app (no build step)  │  HTTP  │  homespace daemon (node:http)      │
│  · overview               │ ─────► │   · /api/system   host + roots     │
│  · content browser        │        │   · /api/files    sandboxed reads  │
│  · session terminal       │ ◄───── │   · /api/sessions ─┐               │
│  · agent control          │  SSE   │   · /api/agents    │               │
└───────────────────────────┘        │   · /api/events    ▼               │
                                     │            claude --print          │
                                     │            (stream-json in/out)    │
                                     └────────────────────────────────────┘
```

## What it does

**Connect to the NAS.** The browser pairs with a daemon by address and bearer
token. Several NAS boxes can be remembered; the last one reconnects on load.

**Look at content files.** Every share you list becomes a *root*. Inside a root
you get a two-pane browser with inline previews — text and code, images, video
and audio with seek support, PDFs — plus filename search and downloads. Nothing
outside a root is reachable, and that is enforced twice (see
[Security](docs/security.md)).

**Start local Claude Code sessions.** A session is a real `claude` process
running on the NAS in a workspace directory you chose, driven over the CLI's
`stream-json` protocol. You send prompts, watch tool calls and results stream
back live, interrupt a turn, or stop the session.

**Control code agents.** An agent is a saved recipe — workspace, model,
permission mode, standing instructions, tool policy — that you can start with
one click and hand tasks to. Agents outlive their sessions, so a worker can be
stopped and restarted without being reconfigured.

## Install

Node 22 or newer, on the NAS, with [Claude Code](https://claude.com/claude-code)
installed and authenticated for the user the daemon runs as.

```sh
git clone https://github.com/IllyaMoore/HomeSpace.git
cd HomeSpace
npm install
npm run build
```

## Set it up

`init` writes a config and generates an access token:

```sh
node dist/cli.js init \
  --root Media=/volume1/media \
  --root Documents=/volume1/documents \
  --workspace Code=/volume1/code
```

`--root` adds a read-only content root. `--workspace` adds one that agents may
use as a working directory. The config lands at `~/.homespace/config.json`
(override with `--config` or `$HOMESPACE_CONFIG`); see
[`config.example.json`](config.example.json) for the full shape.

Check the setup before starting:

```sh
node dist/cli.js doctor
```

It verifies the config parses, every root is mounted and readable, and the
`claude` binary actually runs — and exits non-zero if not, so it works in a
health check.

## Run it

```sh
node dist/cli.js serve
```

By default it binds `127.0.0.1:7333`. To reach it from other devices on the
LAN, set `server.host` to `0.0.0.0` in the config (or pass `--host 0.0.0.0`),
then open `http://<nas>:7333` and paste the token from `homespace token`.

As a systemd user service:

```ini
# ~/.config/systemd/user/homespace.service
[Unit]
Description=HomeSpace
After=network-online.target

[Service]
ExecStart=/usr/bin/node /volume1/homespace/dist/cli.js serve
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```sh
systemctl --user enable --now homespace
```

## CLI

| Command | What it does |
| --- | --- |
| `homespace serve` | Start the daemon (HTTP API + web UI). |
| `homespace init` | Write a starter config with a fresh token. |
| `homespace token` | Print the access token; `--rotate` replaces it. |
| `homespace doctor` | Check config, roots, and Claude Code reachability. |

Flags: `--config <path>`, `--host <h>`, `--port <n>`, `--log <level>`.

## Documentation

- [Architecture](docs/architecture.md) — how the pieces fit, and why.
- [HTTP API](docs/api.md) — every endpoint, with request and response shapes.
- [Security](docs/security.md) — the trust model, and what it does not cover.

## Development

```sh
npm run typecheck   # tsc --noEmit
npm run build       # tsc -> dist/
npm test            # build, then 107 tests against the built output
npm run dev         # tsc --watch
```

The frontend in `web/` has no build step — it is ES modules served as-is, so
editing a view and reloading the page is the whole loop.

## Status

Alpha, and honest about it. Working and covered by tests: connection and
pairing, the system snapshot, the file browser (including its sandbox), session
spawn/prompt/interrupt/stop, the agent registry and lifecycle, and the SSE
stream. Not built yet: multi-user accounts, TLS termination (put it behind a
reverse proxy), an approvals queue for `manual` permission mode, and persisting
transcripts across a daemon restart.

## License

MIT
