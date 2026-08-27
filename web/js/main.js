import { probeServer } from "./api.js";
import { h, icon, mount } from "./dom.js";
import {
  activeServerId,
  applyTheme,
  loadServers,
  loadTheme,
  saveTheme,
  Store,
} from "./store.js";
import { agentFormModal, renderAgents, taskModal } from "./views/agents.js";
import { renderConnect } from "./views/connect.js";
import { renderFiles } from "./views/files.js";
import { renderOverview } from "./views/overview.js";
import { newSessionModal, renderSessions } from "./views/sessions.js";

const root = document.getElementById("root");
const store = new Store();

/** Per-view state that does not belong in the shared store. */
const viewState = {
  files: {
    rootId: null,
    path: "",
    listing: null,
    selected: null,
    loading: false,
    error: null,
    previewLoading: false,
    previewError: null,
    query: "",
    searching: false,
    searchResults: null,
    mobilePreview: false,
  },
  sessions: {
    activeId: null,
    transcripts: new Map(),
    drafts: new Map(),
    stickToBottom: true,
  },
  modal: null,
  sidebarOpen: false,
};

let searchTimer = null;
let stream = null;
let refreshTimer = null;

applyTheme(store.theme);

// --------------------------------------------------------------- actions

const actions = {
  async refresh() {
    await store.refresh();
  },

  go(route) {
    store.route = route;
    viewState.sidebarOpen = false;
    store.emit("route");

    // Reaching Content from the sidebar carries no root or path, so the first
    // visit would render an empty pane. Load the first available root instead.
    if (route === "files" && !viewState.files.listing && !viewState.files.loading) {
      const first = (store.system?.roots ?? []).find((r) => r.available);
      if (first) void actions.browse(first.id, "");
    }
  },

  toggleSidebar() {
    viewState.sidebarOpen = !viewState.sidebarOpen;
    store.emit("sidebar");
  },

  toggleTheme() {
    store.theme = store.theme === "dark" ? "light" : "dark";
    saveTheme(store.theme);
    applyTheme(store.theme);
    store.emit("theme");
  },

  disconnect() {
    closeStream();
    store.disconnect();
  },

  closeModal() {
    viewState.modal = null;
    store.emit("modal");
  },

  // ------------------------------------------------------------- files

  async browse(rootId, path, opts = {}) {
    const state = viewState.files;
    if (!opts.force && state.rootId === rootId && state.path === path && state.listing) {
      store.route = "files";
      store.emit("route");
      return;
    }
    state.rootId = rootId;
    state.path = path ?? "";
    state.query = "";
    state.searchResults = null;
    state.loading = true;
    state.error = null;
    state.selected = null;
    state.mobilePreview = false;
    store.route = "files";
    store.emit("files");

    try {
      state.listing = await store.api.listDir(rootId, state.path);
      state.error = null;
    } catch (err) {
      state.listing = null;
      state.error = err?.message ?? "could not read that directory";
    } finally {
      state.loading = false;
      store.emit("files");
    }
  },

  async select(rootId, path) {
    const state = viewState.files;
    state.selected = { rootId, path, name: path.split("/").pop() ?? path, kind: "binary", sizeBytes: 0, modifiedAt: null, content: null };
    state.previewLoading = true;
    state.previewError = null;
    state.mobilePreview = true;
    store.emit("files");

    try {
      state.selected = await store.api.readFile(rootId, path);
    } catch (err) {
      state.previewError = err?.message ?? "could not read that file";
    } finally {
      state.previewLoading = false;
      store.emit("files");
    }
  },

  closePreview() {
    viewState.files.selected = null;
    viewState.files.mobilePreview = false;
    store.emit("files");
  },

  searchInput(value) {
    const state = viewState.files;
    state.query = value;
    clearTimeout(searchTimer);

    if (value.trim().length < 2) {
      state.searchResults = null;
      state.searching = false;
      store.emit("files");
      return;
    }
    state.searching = true;
    store.emit("files");

    // Debounced: a NAS share search is a directory walk, not an index lookup.
    searchTimer = setTimeout(async () => {
      try {
        state.searchResults = await store.api.searchFiles(state.rootId, value.trim());
      } catch (err) {
        state.searchResults = { hits: [], truncated: false };
        store.toast(err?.message ?? "search failed", "error");
      } finally {
        state.searching = false;
        store.emit("files");
      }
    }, 350);
  },

  // ---------------------------------------------------------- sessions

  openNewSession() {
    viewState.modal = { kind: "new-session" };
    store.emit("modal");
  },

  openSession(id) {
    viewState.sessions.activeId = id;
    viewState.sessions.stickToBottom = true;
    store.route = "sessions";
    store.emit("route");
    if (id) void loadTranscript(id);
  },

  async prompt(id, text) {
    try {
      await store.api.prompt(id, text);
      viewState.sessions.stickToBottom = true;
      await store.refresh();
    } catch (err) {
      store.toast(err?.message ?? "could not send the prompt", "error");
    }
  },

  async interrupt(id) {
    try {
      await store.api.interruptSession(id);
      store.toast("Interrupt sent");
      await store.refresh();
    } catch (err) {
      store.toast(err?.message ?? "could not interrupt", "error");
    }
  },

  async stopSession(id) {
    try {
      await store.api.stopSession(id);
      await store.refresh();
    } catch (err) {
      store.toast(err?.message ?? "could not stop the session", "error");
    }
  },

  async forgetSession(id) {
    try {
      await store.api.forgetSession(id);
      viewState.sessions.transcripts.delete(id);
      viewState.sessions.drafts.delete(id);
      if (viewState.sessions.activeId === id) viewState.sessions.activeId = null;
      await store.refresh();
    } catch (err) {
      store.toast(err?.message ?? "could not remove the session", "error");
    }
  },

  // ------------------------------------------------------------ agents

  openAgentForm(agent) {
    viewState.modal = { kind: "agent-form", agent };
    store.emit("modal");
  },

  openTaskForm(agent) {
    viewState.modal = { kind: "agent-task", agent };
    store.emit("modal");
  },

  async stopAgent(id) {
    try {
      await store.api.stopAgent(id);
      store.toast("Agent stopped");
      await store.refresh();
    } catch (err) {
      store.toast(err?.message ?? "could not stop the agent", "error");
    }
  },

  async deleteAgent(agent) {
    if (!window.confirm(`Delete the agent "${agent.name}"? Its sessions are not affected.`)) return;
    try {
      await store.api.deleteAgent(agent.id);
      store.toast("Agent deleted");
      await store.refresh();
    } catch (err) {
      store.toast(err?.message ?? "could not delete the agent", "error");
    }
  },
};

// ------------------------------------------------------------ transcripts

async function loadTranscript(sessionId) {
  try {
    const { entries } = await store.api.transcript(sessionId);
    viewState.sessions.transcripts.set(sessionId, entries);
    store.emit("transcript");
  } catch (err) {
    store.toast(err?.message ?? "could not load the transcript", "error");
  }
}

function appendEntry(sessionId, entry) {
  const map = viewState.sessions.transcripts;
  const existing = map.get(sessionId);
  if (!existing) return; // Transcript not loaded — it will be fetched on open.
  // The SSE stream can replay an entry the initial fetch already returned.
  if (existing.some((e) => e.seq === entry.seq)) return;
  existing.push(entry);
  if (existing.length > 3000) existing.splice(0, existing.length - 3000);
}

// ------------------------------------------------------------ SSE stream

function openStream() {
  closeStream();
  if (!store.api) return;

  const source = new EventSource(store.api.eventsUrl());
  stream = source;
  store.streamState = "retrying";

  source.onopen = () => {
    store.streamState = "open";
    store.emit("stream");
  };

  source.onerror = () => {
    // EventSource reconnects on its own; reflect the gap in the UI rather than
    // tearing the stream down and hand-rolling a backoff.
    store.streamState = "retrying";
    store.emit("stream");
  };

  const onSessionEvent = (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload.entry && payload.sessionId) {
      // Partial token deltas arrive as raw CLI envelopes with no `seq`; they are
      // for liveness only and are not stored.
      if (typeof payload.entry.seq === "number") {
        appendEntry(payload.sessionId, payload.entry);
        if (payload.sessionId === viewState.sessions.activeId) store.emit("transcript");
      }
      return;
    }
    scheduleRefresh();
  };

  for (const name of ["session.message", "session.status", "session.created", "session.closed"]) {
    source.addEventListener(name, onSessionEvent);
  }
  for (const name of ["agent.created", "agent.updated", "agent.deleted"]) {
    source.addEventListener(name, () => scheduleRefresh());
  }
}

function closeStream() {
  if (stream) {
    stream.close();
    stream = null;
  }
  store.streamState = "closed";
}

/**
 * Status changes arrive in bursts — a single turn fires created, status,
 * message and closed within milliseconds. Coalesce them into one refresh.
 */
let refreshQueued = false;
function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  setTimeout(async () => {
    refreshQueued = false;
    await store.refresh();
  }, 400);
}

// ----------------------------------------------------------------- render

/**
 * The whole tree is rebuilt on every state change, which is fast enough at this
 * size but would otherwise drop the caret mid-sentence whenever an SSE event
 * lands. Elements that can hold a caret carry a `data-focus-key`; we note which
 * one had focus and where the selection was, then put it back afterwards.
 */
function captureFocus() {
  const active = document.activeElement;
  const key = active?.getAttribute?.("data-focus-key");
  if (!key) return null;
  return {
    key,
    start: active.selectionStart ?? null,
    end: active.selectionEnd ?? null,
  };
}

function restoreFocus(snapshot) {
  if (!snapshot) return;
  const target = root.querySelector(`[data-focus-key="${CSS.escape(snapshot.key)}"]`);
  if (!target) return;
  target.focus({ preventScroll: true });
  if (snapshot.start !== null && typeof target.setSelectionRange === "function") {
    try {
      target.setSelectionRange(snapshot.start, snapshot.end ?? snapshot.start);
    } catch {
      // Not a text input after all — focus alone is enough.
    }
  }
}

function render() {
  if (!store.connected) {
    renderConnect(store, root);
    return;
  }

  const focus = captureFocus();

  const shell = h("div.app",
    topbar(),
    h("div.body", sidebar(), h("div.main", { id: "main" })),
    toasts());

  mount(root, shell);

  const main = shell.querySelector("#main");
  switch (store.route) {
    case "files": renderFiles(store, main, actions, viewState.files); break;
    case "sessions": renderSessions(store, main, actions, viewState.sessions); break;
    case "agents": renderAgents(store, main, actions); break;
    default: renderOverview(store, main, actions);
  }

  if (viewState.modal) root.append(renderModal());
  else restoreFocus(focus);
}

function topbar() {
  return h("div.topbar",
    h("div.brand",
      h("button.btn.ghost.icon.only-mobile", { onclick: actions.toggleSidebar, "aria-label": "Menu" }, icon("menu")),
      icon("home"),
      h("div", { style: { minWidth: 0 } },
        h("div.brand-name", store.server?.name ?? "HomeSpace"),
        h("div.brand-host", store.server?.baseUrl ?? ""))),
    h("div.topbar-actions",
      store.streamState !== "open"
        ? h("span.badge.error", { title: "The live event stream is not connected" }, h("span.dot"), store.streamState)
        : null,
      h("button.btn.ghost.icon", {
        onclick: actions.toggleTheme,
        "aria-label": "Toggle theme",
        title: "Toggle theme",
      }, icon(store.theme === "dark" ? "sun" : "moon")),
      h("button.btn.ghost.icon", {
        onclick: actions.disconnect,
        "aria-label": "Disconnect",
        title: "Disconnect from this NAS",
      }, icon("logout"))));
}

function sidebar() {
  const workingSessions = store.sessions.filter((s) => s.status === "working").length;
  const liveAgents = store.agents.filter((a) => a.status === "running" || a.status === "working").length;

  const item = (route, iconName, label, count) =>
    h("button.nav-item", {
      "aria-current": store.route === route ? "page" : null,
      onclick: () => actions.go(route),
    }, icon(iconName), label, count ? h("span.nav-count", count) : null);

  return h(`div.sidebar${viewState.sidebarOpen ? ".open" : ""}`,
    item("overview", "home", "Overview"),
    item("files", "files", "Content"),
    item("sessions", "terminal", "Sessions", workingSessions || null),
    item("agents", "agents", "Agents", liveAgents || null),
    h("div.nav-heading", "Roots"),
    ...(store.system?.roots ?? []).map((rootEntry) =>
      h("button.nav-item", {
        disabled: !rootEntry.available || null,
        onclick: () => actions.browse(rootEntry.id, ""),
        title: rootEntry.path,
      }, icon("folder"), rootEntry.label)));
}

function renderModal() {
  const { kind, agent } = viewState.modal;
  let node;
  if (kind === "new-session") node = newSessionModal(store, actions);
  else if (kind === "agent-form") node = agentFormModal(store, actions, agent);
  else if (kind === "agent-task") node = taskModal(store, actions, agent);
  else return document.createComment("no modal");

  node.addEventListener("dismiss", actions.closeModal);
  return node;
}

function toasts() {
  return h("div.toasts", ...store.toasts.map((toast) => h(`div.toast.${toast.kind}`, toast.message)));
}

// ------------------------------------------------------------------- boot

store.on((reason) => {
  render();
  if (reason === "connected") {
    openStream();
    startPolling();
  }
  if (reason === "disconnect") stopPolling();
});

/**
 * The SSE stream carries every change, but a poll every 20s catches the case
 * where the stream silently died behind a proxy and EventSource has not
 * noticed yet.
 */
function startPolling() {
  stopPolling();
  refreshTimer = setInterval(() => void store.refresh(), 20_000);
}
function stopPolling() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && viewState.modal) actions.closeModal();
});

window.addEventListener("beforeunload", closeStream);

/** Reconnect to whichever NAS was last in use, if its token still works. */
async function boot() {
  const wanted = activeServerId();
  const saved = loadServers();
  const candidate = saved.find((s) => s.id === wanted) ?? null;

  if (!candidate) {
    render();
    return;
  }

  mount(root, h("div.boot", `Reconnecting to ${candidate.name}…`));
  try {
    const { health } = await probeServer(candidate.baseUrl, candidate.token);
    store.connect({ ...candidate, name: health.name || candidate.name });
    await store.refresh();
    store.emit("connected");
  } catch {
    // Stale token or the NAS is asleep — fall back to the connect gate rather
    // than blocking on a retry the operator cannot see.
    store.connected = false;
    render();
  }
}

void boot();
