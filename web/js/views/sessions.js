import { formatBytes, formatNumber, formatRelative, h, icon, mount } from "../dom.js";

/**
 * Session list plus a live transcript. The transcript is fed by the SSE stream
 * in main.js, so this view only ever renders what is already in `state`.
 */
export function renderSessions(store, root, actions, state) {
  const sessions = store.sessions;
  const active = sessions.find((s) => s.id === state.activeId) ?? null;

  const listColumn = h("div.session-list",
    h("button.btn.primary", { onclick: () => actions.openNewSession() }, icon("plus"), "New session"),
    sessions.length === 0
      ? h("div.empty", { style: { padding: "20px 12px" } }, "No sessions yet.")
      : sessions.map((session) => sessionChip(session, store, state, actions)));

  const detailPane = h("div.pane");
  const layout = h(`div.session-layout${active ? "" : ".show-list"}`, listColumn, detailPane);

  mount(root, h("div.view", { style: { display: "flex", flexDirection: "column" } },
    h("div.view-header",
      h("div",
        h("div.view-title", "Sessions"),
        h("div.view-sub", `Claude Code running on ${store.system?.hostname ?? "the NAS"}`)),
      h("div", { style: { display: "flex", gap: "8px" } },
        h("span.badge", { title: "Live event stream" },
          h("span.dot", { style: { background: store.streamState === "open" ? "var(--signal-success)" : "var(--signal-warning)" } }),
          store.streamState === "open" ? "live" : store.streamState),
        h("button.btn.sm", { onclick: () => void actions.refresh() }, icon("refresh"), "Refresh"))),
    layout));

  if (active) renderDetail(detailPane, store, active, actions, state);
  else mount(detailPane, h("div.empty", { style: { margin: "auto", border: "0" } },
    "Select a session, or start a new one to run Claude Code on the NAS."));
}

function sessionChip(session, store, state, actions) {
  const agent = store.agents.find((a) => a.id === session.agentId);
  return h("button.session-chip", {
    "aria-current": session.id === state.activeId ? "true" : null,
    onclick: () => actions.openSession(session.id),
  },
    h("div.title", session.title),
    h("div.sub",
      h(`span.badge.${session.status}`, h("span.dot"), session.status),
      agent ? h("span", agent.name) : null,
      h("span", formatRelative(session.lastActivityAt))));
}

function renderDetail(pane, store, session, actions, state) {
  const busy = session.status === "working";
  const alive = session.status === "idle" || session.status === "working" || session.status === "starting";

  const head = h("div.pane-head",
    h("button.btn.ghost.sm.only-mobile", { onclick: () => actions.openSession(null) }, icon("back")),
    h("div", { style: { minWidth: 0, flex: 1 } },
      h("div.pane-title", session.title),
      h("div", { style: { fontSize: "11px", color: "var(--text-muted)" } },
        `${session.model ?? "default model"} · ${session.permissionMode} · ${session.workspacePath}`)),
    h(`span.badge.${session.status}`, h("span.dot"), session.status),
    busy
      ? h("button.btn.sm", { onclick: () => void actions.interrupt(session.id), title: "Ask Claude to abandon this turn" }, icon("pause"), "Interrupt")
      : null,
    alive
      ? h("button.btn.sm.danger", { onclick: () => void actions.stopSession(session.id) }, icon("stop"), "Stop")
      : h("button.btn.sm.danger", { onclick: () => void actions.forgetSession(session.id) }, icon("trash"), "Forget"));

  const transcript = h("div.transcript");
  const entries = state.transcripts.get(session.id) ?? [];
  mount(transcript, entries.length === 0
    ? h("div.empty", { style: { border: "0" } }, "No output yet.")
    : entries.map(renderEntry));

  const input = h("textarea", {
    // The shell re-renders on every SSE event. This key lets it put the caret
    // back where it was, and the draft below survives the rebuild.
    "data-focus-key": `composer:${session.id}`,
    placeholder: alive ? "Send a prompt to this session…  (Enter to send, Shift+Enter for a newline)" : "This session has exited.",
    disabled: !alive || null,
    rows: "2",
    onkeydown: (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    },
    oninput: (event) => {
      state.drafts.set(session.id, event.target.value);
      // Grow with the content up to the CSS max-height, then scroll.
      event.target.style.height = "auto";
      event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
    },
  });
  input.value = state.drafts.get(session.id) ?? "";

  const send = () => {
    const text = input.value.trim();
    if (!text || !alive) return;
    input.value = "";
    state.drafts.delete(session.id);
    input.style.height = "auto";
    void actions.prompt(session.id, text);
  };

  const composer = h("div.composer", input,
    h("div.composer-actions",
      h("button.btn.primary", { disabled: !alive || null, onclick: send }, icon("send"), "Send")));

  const footer = h("div", {
    style: {
      padding: "6px 12px", borderTop: "1px solid var(--surface-border)",
      fontSize: "11px", color: "var(--text-muted)", display: "flex", gap: "14px", flexWrap: "wrap",
    },
  },
    h("span", `${session.turns} turns`),
    h("span", `${formatNumber(session.usage?.inputTokens ?? 0)} in / ${formatNumber(session.usage?.outputTokens ?? 0)} out`),
    session.costUsd > 0 ? h("span", `$${session.costUsd.toFixed(4)}`) : null,
    h("span.mono", { title: "Resume from a shell with: claude --resume <id>" }, session.claudeSessionId),
    session.lastError ? h("span", { style: { color: "var(--signal-error)" } }, session.lastError.slice(0, 160)) : null);

  mount(pane, head, transcript, footer, composer);

  // Keep the newest output in view unless the operator has scrolled up to read.
  requestAnimationFrame(() => {
    if (state.stickToBottom !== false) transcript.scrollTop = transcript.scrollHeight;
  });
  transcript.addEventListener("scroll", () => {
    const distance = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    state.stickToBottom = distance < 80;
  });
}

function renderEntry(entry) {
  switch (entry.kind) {
    case "user":
      return block("user", "you", entry.text);
    case "assistant":
      return block("assistant", "claude", entry.text);
    case "thinking":
      return block("thinking", "thinking", entry.text);
    case "init":
      return block("notice", "session started",
        `${entry.model ?? "default model"}${entry.cwd ? ` · ${entry.cwd}` : ""}${entry.tools?.length ? ` · ${entry.tools.length} tools` : ""}`);
    case "tool_use":
      return block("tool_use", `tool · ${entry.name}`, summarizeInput(entry.input));
    case "tool_result":
      return block(`tool_result${entry.isError ? " failed" : ""}`, entry.isError ? "tool error" : "tool result",
        truncate(entry.text, 4000));
    case "notice":
      return block("notice", entry.level, entry.text);
    case "result": {
      const bits = [entry.subtype];
      if (entry.durationMs !== null) bits.push(`${(entry.durationMs / 1000).toFixed(1)}s`);
      if (entry.usage) bits.push(`${formatNumber(entry.usage.outputTokens)} out`);
      if (entry.costUsd !== null) bits.push(`$${entry.costUsd.toFixed(4)}`);
      return block(`result${entry.isError ? " failed" : ""}`, "turn complete",
        [bits.join(" · "), entry.text].filter(Boolean).join("\n"));
    }
    default:
      return block("raw", "raw", truncate(JSON.stringify(entry.payload ?? entry, null, 2), 2000));
  }
}

function block(kind, label, text) {
  return h(`div.entry.${kind.split(" ").join(".")}`,
    h("div.entry-head", label),
    h("div.entry-body", text || "(empty)"));
}

function summarizeInput(input) {
  if (input === null || input === undefined) return "(no input)";
  if (typeof input === "string") return truncate(input, 1500);

  // Show the fields that actually identify what the tool is about to do,
  // instead of a wall of JSON.
  const notable = ["command", "file_path", "path", "pattern", "query", "url", "prompt", "description"];
  const lines = [];
  for (const key of notable) {
    const value = input[key];
    if (typeof value === "string" && value) lines.push(`${key}: ${truncate(value, 600)}`);
  }
  if (lines.length > 0) return lines.join("\n");
  return truncate(JSON.stringify(input, null, 2), 1500);
}

function truncate(text, max) {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max)}\n… (${formatBytes(value.length - max)} more)` : value;
}

/** Modal for starting an ad-hoc session outside of any saved agent. */
export function newSessionModal(store, actions) {
  const workspaces = (store.system?.roots ?? []).filter((r) => r.workspace && r.available);

  if (workspaces.length === 0) {
    return modalShell("Start a session",
      h("div.empty", "No writable workspace root is available. Mark a root with \"workspace\": true in the server config."),
      [h("button.btn", { onclick: actions.closeModal }, "Close")]);
  }

  const rootSelect = h("select", ...workspaces.map((r) => h("option", { value: r.id }, `${r.label} — ${r.path}`)));
  const pathInput = h("input", { type: "text", placeholder: "subdirectory (optional)", spellcheck: "false" });
  const titleInput = h("input", { type: "text", placeholder: "e.g. media cleanup" });
  const modelInput = h("input", { type: "text", placeholder: store.system?.claude.defaultModel ?? "CLI default" });
  const modeSelect = h("select", ...["manual", "acceptEdits", "auto", "plan", "dontAsk", "bypassPermissions"]
    .map((mode) => h("option", { value: mode, selected: mode === store.system?.claude.defaultPermissionMode || null }, mode)));
  const taskInput = h("textarea", { placeholder: "Opening prompt (optional)" });
  const error = h("div.field-hint", { style: { color: "var(--signal-error)" } });

  const create = async () => {
    try {
      const session = await store.api.startSession({
        rootId: rootSelect.value,
        path: pathInput.value.trim(),
        title: titleInput.value.trim() || undefined,
        model: modelInput.value.trim() || undefined,
        permissionMode: modeSelect.value,
      });
      const task = taskInput.value.trim();
      if (task) await store.api.prompt(session.id, task);
      actions.closeModal();
      await actions.refresh();
      actions.openSession(session.id);
    } catch (err) {
      error.textContent = err?.message ?? "could not start the session";
    }
  };

  return modalShell("Start a session",
    h("div",
      h("label.field", h("span", "Workspace root"), rootSelect),
      h("label.field", h("span", "Subdirectory"), pathInput,
        h("div.field-hint", "Relative to the root. Leave blank to use the root itself.")),
      h("label.field", h("span", "Title"), titleInput),
      h("div.field-row",
        h("label.field", h("span", "Model"), modelInput),
        h("label.field", h("span", "Permission mode"), modeSelect)),
      h("label.field", h("span", "Opening prompt"), taskInput),
      error),
    [
      h("button.btn", { onclick: actions.closeModal }, "Cancel"),
      h("button.btn.primary", { onclick: () => void create() }, "Start"),
    ]);
}

export function modalShell(title, body, actionButtons) {
  return h("div.modal-backdrop", {
    onclick: (event) => { if (event.target === event.currentTarget) event.currentTarget.dispatchEvent(new CustomEvent("dismiss", { bubbles: true })); },
  }, h("div.modal", h("h2", title), body, h("div.modal-actions", ...actionButtons)));
}
