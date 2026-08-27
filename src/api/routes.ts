import type { HomeSpaceConfig } from "../config.js";
import type { EventBus } from "../core/events.js";
import type { Logger } from "../core/logger.js";
import { findRoot } from "../core/paths.js";
import { readJson, requireString } from "../http/body.js";
import { HttpError, sendJson, sendNoContent } from "../http/respond.js";
import { Router } from "../http/router.js";
import { SseStream } from "../http/sse.js";
import type { AgentStore } from "../services/agents.js";
import * as files from "../services/files.js";
import type { SessionManager } from "../services/sessions.js";
import { snapshot } from "../services/system.js";

export type ApiDeps = {
  config: HomeSpaceConfig;
  sessions: SessionManager;
  agents: AgentStore;
  bus: EventBus;
  logger: Logger;
  version: string;
  startedAt: string;
};

export function buildRouter(deps: ApiDeps): Router {
  const router = new Router();
  const { config, sessions, agents, bus } = deps;

  // ---------------------------------------------------------------- health
  // The one unauthenticated route: it lets a client confirm it is talking to a
  // HomeSpace daemon before it has a token to offer. It deliberately reveals
  // nothing but the name the operator chose.
  router.get("/api/health", ({ res }) => {
    sendJson(res, 200, {
      service: "homespace",
      status: "ok",
      name: config.name,
      version: deps.version,
      startedAt: deps.startedAt,
      serverTime: new Date().toISOString(),
    });
  });

  // ---------------------------------------------------------------- system
  router.get("/api/system", async ({ res }) => {
    sendJson(res, 200, await snapshot(config));
  });

  // ----------------------------------------------------------------- files
  router.get("/api/files", ({ res }) => {
    sendJson(res, 200, {
      roots: config.roots.map(({ id, label, workspace, readOnly }) => ({
        id,
        label,
        workspace,
        readOnly,
      })),
    });
  });

  router.get("/api/files/:rootId/list/*", async ({ res, params, wildcard, query }) => {
    const root = findRoot(config.roots, params.rootId!);
    sendJson(
      res,
      200,
      await files.list(root, wildcard, {
        limit: numberParam(query, "limit"),
        showHidden: query.get("hidden") === "1",
      }),
    );
  });

  router.get("/api/files/:rootId/read/*", async ({ res, params, wildcard }) => {
    const root = findRoot(config.roots, params.rootId!);
    sendJson(res, 200, await files.read(root, wildcard));
  });

  router.get("/api/files/:rootId/raw/*", async ({ req, res, params, wildcard, query }) => {
    const root = findRoot(config.roots, params.rootId!);
    await files.stream(
      res,
      root,
      wildcard,
      req.headers.range,
      query.get("download") === "1" ? "attachment" : "inline",
    );
  });

  router.get("/api/files/:rootId/search", async ({ res, params, query }) => {
    const root = findRoot(config.roots, params.rootId!);
    const q = query.get("q");
    if (!q) throw new HttpError(400, `"q" query parameter is required`);
    sendJson(res, 200, await files.search(root, q, { limit: numberParam(query, "limit") }));
  });

  // -------------------------------------------------------------- sessions
  router.get("/api/sessions", ({ res }) => {
    sendJson(res, 200, { sessions: sessions.list() });
  });

  router.post("/api/sessions", async ({ req, res }) => {
    const body = await readJson<Record<string, unknown>>(req);
    const rootId = requireString(body, "rootId");
    const root = findRoot(config.roots, rootId);
    const { resolveWithinRoot } = await import("../core/paths.js");
    const resolved = await resolveWithinRoot(root, requireString(body, "path", { optional: true }));

    sendJson(res, 201, sessions.start({
      root,
      workspacePath: resolved.absolute,
      title: requireString(body, "title", { optional: true, maxLength: 120 }) || undefined,
      model: typeof body.model === "string" && body.model ? body.model : undefined,
      permissionMode: body.permissionMode as never,
      systemPromptAppend: typeof body.instructions === "string" ? body.instructions : null,
    }));
  });

  router.get("/api/sessions/:id", ({ res, params }) => {
    sendJson(res, 200, sessions.summary(params.id!));
  });

  router.get("/api/sessions/:id/transcript", ({ res, params, query }) => {
    const id = params.id!;
    sendJson(res, 200, {
      session: sessions.summary(id),
      entries: sessions.transcript(id, {
        since: numberParam(query, "since"),
        limit: numberParam(query, "limit"),
      }),
    });
  });

  router.post("/api/sessions/:id/prompt", async ({ req, res, params }) => {
    const body = await readJson<Record<string, unknown>>(req);
    sendJson(res, 202, sessions.send(params.id!, requireString(body, "text", { maxLength: 100_000 })));
  });

  router.post("/api/sessions/:id/interrupt", ({ res, params }) => {
    sendJson(res, 202, sessions.interrupt(params.id!));
  });

  router.post("/api/sessions/:id/stop", async ({ res, params }) => {
    sendJson(res, 200, await sessions.stop(params.id!));
  });

  router.delete("/api/sessions/:id", ({ res, params }) => {
    sessions.remove(params.id!);
    sendNoContent(res);
  });

  // ---------------------------------------------------------------- agents
  router.get("/api/agents", ({ res }) => {
    sendJson(res, 200, { agents: agents.list() });
  });

  router.post("/api/agents", async ({ req, res }) => {
    sendJson(res, 201, await agents.create(await readJson(req)));
  });

  router.get("/api/agents/:id", ({ res, params }) => {
    sendJson(res, 200, agents.get(params.id!));
  });

  router.patch("/api/agents/:id", async ({ req, res, params }) => {
    sendJson(res, 200, await agents.update(params.id!, await readJson(req)));
  });

  router.delete("/api/agents/:id", async ({ res, params }) => {
    await agents.remove(params.id!);
    sendNoContent(res);
  });

  router.post("/api/agents/:id/start", async ({ req, res, params }) => {
    const body = await readJson<Record<string, unknown>>(req);
    sendJson(res, 201, await agents.start(params.id!, requireString(body, "task", { optional: true, maxLength: 100_000 })));
  });

  router.post("/api/agents/:id/task", async ({ req, res, params }) => {
    const body = await readJson<Record<string, unknown>>(req);
    sendJson(res, 202, await agents.assign(params.id!, requireString(body, "task", { maxLength: 100_000 })));
  });

  router.post("/api/agents/:id/stop", async ({ res, params }) => {
    sendJson(res, 200, { stopped: await agents.stopAll(params.id!) });
  });

  // ---------------------------------------------------------------- events
  // One SSE stream carries every state change. The browser opens it once and
  // the whole UI reacts off it, instead of polling five endpoints.
  router.get("/api/events", ({ res, query }) => {
    const stream = new SseStream(res);
    const sessionFilter = query.get("sessionId");

    stream.send("hello", { name: config.name, at: new Date().toISOString() });

    const unsubscribe = bus.subscribe((event) => {
      if (sessionFilter && "sessionId" in event && event.sessionId !== sessionFilter) return;
      stream.send(event.type, event);
      if (stream.closed) unsubscribe();
    });

    res.on("close", unsubscribe);
  });

  return router;
}

function numberParam(query: URLSearchParams, name: string): number | undefined {
  const raw = query.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new HttpError(400, `"${name}" must be a number`);
  return value;
}
