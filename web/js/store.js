import { Api } from "./api.js";

const KEY_SERVERS = "homespace.servers";
const KEY_ACTIVE = "homespace.active";
const KEY_THEME = "homespace.theme";

/**
 * Every read/write is wrapped: a private window, or a browser configured to
 * block site data, throws on access rather than returning null, and the app
 * must still work.
 */
function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not fatal — the session just will not be remembered.
  }
}

export function loadServers() {
  const list = readJson(KEY_SERVERS, []);
  return Array.isArray(list) ? list.filter((s) => s && typeof s.id === "string") : [];
}

export function saveServer(server) {
  const servers = loadServers().filter((s) => s.id !== server.id);
  servers.unshift(server);
  writeJson(KEY_SERVERS, servers.slice(0, 8));
}

export function forgetServer(id) {
  writeJson(KEY_SERVERS, loadServers().filter((s) => s.id !== id));
  if (readJson(KEY_ACTIVE, null) === id) writeJson(KEY_ACTIVE, null);
}

export function setActiveServer(id) { writeJson(KEY_ACTIVE, id); }
export function activeServerId() { return readJson(KEY_ACTIVE, null); }

export function serverId(baseUrl) {
  return (baseUrl || window.location.origin).replace(/\/+$/, "").toLowerCase();
}

export function loadTheme() {
  const stored = readJson(KEY_THEME, null);
  return stored === "light" || stored === "dark" ? stored : "dark";
}

export function saveTheme(theme) { writeJson(KEY_THEME, theme); }

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Central app state. Views never talk to each other — they read this and call
 * `emit()`, and `main.js` re-renders whatever changed.
 */
export class Store {
  constructor() {
    this.api = null;
    this.server = null;      // { id, name, baseUrl, token }
    this.system = null;      // /api/system snapshot
    this.sessions = [];
    this.agents = [];
    this.route = "overview";
    this.connected = false;
    this.streamState = "closed";  // closed | open | retrying
    this.theme = loadTheme();
    this.error = null;
    this.toasts = [];
    this.#listeners = new Set();
  }

  #listeners;

  on(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(reason = "state") {
    for (const listener of [...this.#listeners]) listener(reason, this);
  }

  connect(server) {
    this.server = server;
    this.api = new Api(server.baseUrl, server.token);
    this.connected = true;
    setActiveServer(server.id);
  }

  disconnect() {
    this.api = null;
    this.server = null;
    this.system = null;
    this.sessions = [];
    this.agents = [];
    this.connected = false;
    this.streamState = "closed";
    setActiveServer(null);
    this.emit("disconnect");
  }

  toast(message, kind = "info") {
    const entry = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, message, kind };
    this.toasts = [...this.toasts, entry];
    this.emit("toast");
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== entry.id);
      this.emit("toast");
    }, kind === "error" ? 7000 : 3500);
  }

  /** Refresh the three collections the chrome depends on. */
  async refresh() {
    if (!this.api) return;
    const [system, sessions, agents] = await Promise.allSettled([
      this.api.system(),
      this.api.sessions(),
      this.api.agents(),
    ]);
    if (system.status === "fulfilled") this.system = system.value;
    if (sessions.status === "fulfilled") this.sessions = sessions.value.sessions ?? [];
    if (agents.status === "fulfilled") this.agents = agents.value.agents ?? [];

    const failure = [system, sessions, agents].find((r) => r.status === "rejected");
    this.error = failure ? (failure.reason?.message ?? "refresh failed") : null;
    this.emit("refresh");
  }
}
