import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { normalizeConfig } from "../dist/config.js";
import { createLogger } from "../dist/core/logger.js";
import { createHomeSpaceServer } from "../dist/server.js";

const TOKEN = "test-token-0123456789abcdef";

let base;
let instance;
let origin;

/** Fetch against the live server, with the bearer token unless told otherwise. */
async function call(path, { method = "GET", body, token = TOKEN, headers = {} } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: response.status, json, text, headers: response.headers };
}

before(async () => {
  base = await mkdtemp(join(tmpdir(), "homespace-server-"));
  await fs.mkdir(join(base, "content"), { recursive: true });
  await fs.mkdir(join(base, "code"), { recursive: true });
  await fs.writeFile(join(base, "content", "note.md"), "hello\n");

  const config = normalizeConfig({
    name: "Test NAS",
    // Port 0 lets the OS pick a free one, so the suite never collides with a
    // real daemon or a parallel run.
    server: { host: "127.0.0.1", port: 0, token: TOKEN },
    roots: [
      { id: "content", label: "Content", path: join(base, "content"), readOnly: true },
      { id: "code", label: "Code", path: join(base, "code"), workspace: true, readOnly: false },
    ],
    // A binary that does not exist: session spawning is covered elsewhere, and
    // these tests must not shell out to a real model.
    claude: { bin: join(base, "no-such-claude") },
    dataDir: join(base, "data"),
  });

  instance = await createHomeSpaceServer(config, createLogger("test", "error"));
  origin = `http://127.0.0.1:${instance.server.address().port}`;
});

after(async () => {
  await instance?.close();
  await fs.rm(base, { recursive: true, force: true });
});

describe("auth", () => {
  it("serves /api/health without a token", async () => {
    const { status, json } = await call("/api/health", { token: null });
    assert.equal(status, 200);
    assert.equal(json.service, "homespace");
    assert.equal(json.name, "Test NAS");
  });

  it("401s every other API route without a token", async () => {
    for (const path of ["/api/system", "/api/files", "/api/sessions", "/api/agents"]) {
      assert.equal((await call(path, { token: null })).status, 401, path);
    }
  });

  it("401s on a wrong token", async () => {
    assert.equal((await call("/api/system", { token: "wrong-token-wrong-token" })).status, 401);
  });

  it("accepts the token as a query parameter, for EventSource", async () => {
    const response = await fetch(`${origin}/api/system?token=${encodeURIComponent(TOKEN)}`);
    assert.equal(response.status, 200);
    await response.body?.cancel();
  });
});

describe("routing", () => {
  it("404s an unknown API path", async () => {
    assert.equal((await call("/api/nope")).status, 404);
  });

  it("405s a known path with the wrong method", async () => {
    assert.equal((await call("/api/health", { method: "DELETE", token: null })).status, 405);
  });

  it("serves the app shell for an unknown non-asset path", async () => {
    const { status, text } = await call("/agents", { token: null });
    assert.equal(status, 200);
    assert.match(text, /<div id="root"/);
  });

  it("sends hardening headers on every response", async () => {
    const { headers } = await call("/api/health", { token: null });
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("x-frame-options"), "SAMEORIGIN");
  });

  it("refuses a cross-origin preflight from an origin that is not allowed", async () => {
    const { status } = await call("/api/system", { method: "OPTIONS", headers: { origin: "http://evil.example" } });
    assert.equal(status, 403);
  });
});

describe("system", () => {
  it("reports both roots and a missing claude binary", async () => {
    const { status, json } = await call("/api/system");
    assert.equal(status, 200);
    assert.equal(json.claude.available, false);
    assert.deepEqual(json.roots.map((r) => r.id), ["content", "code"]);
    assert.equal(json.roots[0].available, true);
    assert.equal(json.roots[1].workspace, true);
  });
});

describe("files", () => {
  it("lists a root and reads a file", async () => {
    const listing = await call("/api/files/content/list/");
    assert.equal(listing.status, 200);
    assert.deepEqual(listing.json.entries.map((e) => e.name), ["note.md"]);

    const detail = await call("/api/files/content/read/note.md");
    assert.equal(detail.json.content, "hello\n");
  });

  it("streams a raw file with an ETag-free but ranged response", async () => {
    const response = await fetch(`${origin}/api/files/content/raw/note.md`, {
      headers: { authorization: `Bearer ${TOKEN}`, range: "bytes=0-2" },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 0-2/6");
    assert.equal(await response.text(), "hel");
  });

  it("403s a traversal attempt", async () => {
    assert.equal((await call("/api/files/content/list/..%2F..%2Fetc")).status, 403);
  });

  it("404s an unknown root", async () => {
    assert.equal((await call("/api/files/nope/list/")).status, 404);
  });
});

describe("agents", () => {
  let agentId;

  it("starts with an empty registry", async () => {
    const { json } = await call("/api/agents");
    assert.deepEqual(json.agents, []);
  });

  it("refuses an agent on a non-workspace root", async () => {
    const { status, json } = await call("/api/agents", { method: "POST", body: { name: "x", rootId: "content" } });
    assert.equal(status, 400);
    assert.match(json.error, /not marked as a workspace/);
  });

  it("refuses an agent whose path escapes its root", async () => {
    const { status } = await call("/api/agents", { method: "POST", body: { name: "x", rootId: "code", path: "../.." } });
    assert.equal(status, 403);
  });

  it("requires a name", async () => {
    assert.equal((await call("/api/agents", { method: "POST", body: { rootId: "code" } })).status, 400);
  });

  it("creates, reads back, and persists an agent", async () => {
    const created = await call("/api/agents", {
      method: "POST",
      body: { name: "Tidy", description: "keeps things neat", rootId: "code", permissionMode: "plan" },
    });
    assert.equal(created.status, 201);
    agentId = created.json.id;
    assert.equal(created.json.status, "idle");
    assert.equal(created.json.workspacePath, join(base, "code"));

    const stored = JSON.parse(await fs.readFile(join(base, "data", "agents.json"), "utf8"));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].name, "Tidy");
  });

  it("updates an agent in place", async () => {
    const { status, json } = await call(`/api/agents/${agentId}`, {
      method: "PATCH",
      body: { description: "renamed purpose" },
    });
    assert.equal(status, 200);
    assert.equal(json.description, "renamed purpose");
    assert.equal(json.name, "Tidy");
  });

  it("surfaces a failure to start when claude is missing, rather than hanging", async () => {
    const { status, json } = await call(`/api/agents/${agentId}/start`, { method: "POST", body: {} });
    // The session record is created, then the spawn fails asynchronously.
    assert.equal(status, 201);
    await new Promise((done) => setTimeout(done, 300));
    const session = await call(`/api/sessions/${json.session.id}`);
    assert.equal(session.json.status, "error");
    assert.match(session.json.lastError, /no-such-claude|ENOENT|spawn/i);
  });

  it("deletes an agent", async () => {
    assert.equal((await call(`/api/agents/${agentId}`, { method: "DELETE" })).status, 204);
    assert.deepEqual((await call("/api/agents")).json.agents, []);
  });

  it("404s an unknown agent", async () => {
    assert.equal((await call("/api/agents/agent_missing")).status, 404);
  });
});

describe("events", () => {
  it("opens an SSE stream and greets the client", async () => {
    const controller = new AbortController();
    const response = await fetch(`${origin}/api/events?token=${encodeURIComponent(TOKEN)}`, {
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);

    const reader = response.body.getReader();
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /connected|event: hello/);
    controller.abort();
  });
});
