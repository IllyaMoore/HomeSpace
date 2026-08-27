/**
 * Typed-ish client for the HomeSpace daemon. One instance per connected NAS;
 * `baseUrl` is empty when the UI is served by the daemon itself (the common
 * case) and absolute when a browser on another machine points at it.
 */
export class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export class Api {
  constructor(baseUrl, token) {
    this.baseUrl = (baseUrl || "").replace(/\/+$/, "");
    this.token = token || "";
  }

  url(path, query) {
    const url = new URL(`${this.baseUrl}${path}`, window.location.origin);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  /** Href for an <img>/<video>/download — EventSource and media tags cannot
   *  send an Authorization header, so those carry the token in the query. */
  rawUrl(rootId, path, opts = {}) {
    return this.url(`/api/files/${encodeURIComponent(rootId)}/raw/${encodePath(path)}`, {
      token: this.token,
      download: opts.download ? "1" : undefined,
    });
  }

  eventsUrl(sessionId) {
    return this.url("/api/events", { token: this.token, sessionId });
  }

  async request(method, path, { query, body, signal } = {}) {
    const headers = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    let response;
    try {
      response = await fetch(this.url(path, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      throw new ApiError(0, `cannot reach the server (${err?.message ?? "network error"})`);
    }

    if (response.status === 204) return null;

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text.slice(0, 300) };
      }
    }

    if (!response.ok) {
      throw new ApiError(response.status, payload?.error ?? `request failed (${response.status})`, payload?.detail);
    }
    return payload;
  }

  get(path, query, signal) { return this.request("GET", path, { query, signal }); }
  post(path, body) { return this.request("POST", path, { body }); }
  patch(path, body) { return this.request("PATCH", path, { body }); }
  del(path) { return this.request("DELETE", path); }

  // ---------------------------------------------------------------- surface

  health() { return this.get("/api/health"); }
  system() { return this.get("/api/system"); }

  roots() { return this.get("/api/files"); }
  listDir(rootId, path, opts = {}) {
    return this.get(`/api/files/${encodeURIComponent(rootId)}/list/${encodePath(path)}`, {
      hidden: opts.hidden ? "1" : undefined,
    });
  }
  readFile(rootId, path) {
    return this.get(`/api/files/${encodeURIComponent(rootId)}/read/${encodePath(path)}`);
  }
  searchFiles(rootId, q, signal) {
    return this.get(`/api/files/${encodeURIComponent(rootId)}/search`, { q }, signal);
  }

  sessions() { return this.get("/api/sessions"); }
  startSession(payload) { return this.post("/api/sessions", payload); }
  session(id) { return this.get(`/api/sessions/${encodeURIComponent(id)}`); }
  transcript(id, since) {
    return this.get(`/api/sessions/${encodeURIComponent(id)}/transcript`, { since });
  }
  prompt(id, text) { return this.post(`/api/sessions/${encodeURIComponent(id)}/prompt`, { text }); }
  interruptSession(id) { return this.post(`/api/sessions/${encodeURIComponent(id)}/interrupt`, {}); }
  stopSession(id) { return this.post(`/api/sessions/${encodeURIComponent(id)}/stop`, {}); }
  forgetSession(id) { return this.del(`/api/sessions/${encodeURIComponent(id)}`); }

  agents() { return this.get("/api/agents"); }
  createAgent(payload) { return this.post("/api/agents", payload); }
  updateAgent(id, payload) { return this.patch(`/api/agents/${encodeURIComponent(id)}`, payload); }
  deleteAgent(id) { return this.del(`/api/agents/${encodeURIComponent(id)}`); }
  startAgent(id, task) { return this.post(`/api/agents/${encodeURIComponent(id)}/start`, { task }); }
  assignTask(id, task) { return this.post(`/api/agents/${encodeURIComponent(id)}/task`, { task }); }
  stopAgent(id) { return this.post(`/api/agents/${encodeURIComponent(id)}/stop`, {}); }
}

/** Encode each segment but keep the slashes — the wildcard route wants a path. */
function encodePath(path) {
  return String(path || "")
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

/**
 * Probe a candidate NAS before storing it. /api/health is unauthenticated so we
 * can tell "wrong address" apart from "wrong token", then one authenticated
 * call confirms the token.
 */
export async function probeServer(baseUrl, token) {
  const api = new Api(baseUrl, token);
  const health = await api.health();
  if (health?.service !== "homespace") {
    throw new ApiError(0, "that address answered, but it is not a HomeSpace server");
  }
  await api.system(); // 401 here means a bad token.
  return { api, health };
}
