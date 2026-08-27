import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRouter, type ApiDeps } from "./api/routes.js";
import type { HomeSpaceConfig } from "./config.js";
import { EventBus } from "./core/events.js";
import { createLogger, type Logger } from "./core/logger.js";
import { PathError } from "./core/paths.js";
import { requireAuth, resolveCorsOrigin } from "./http/auth.js";
import { HttpError, sendError, sendJson } from "./http/respond.js";
import { serveStatic } from "./http/static.js";
import { AgentStore } from "./services/agents.js";
import { SessionManager } from "./services/sessions.js";

export const VERSION = "0.1.0";

/** dist/server.js -> package root -> web/ */
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "web");

export type HomeSpaceServer = {
  server: Server;
  sessions: SessionManager;
  agents: AgentStore;
  bus: EventBus;
  url: string;
  close(): Promise<void>;
};

export async function createHomeSpaceServer(
  config: HomeSpaceConfig,
  logger: Logger = createLogger(),
): Promise<HomeSpaceServer> {
  const bus = new EventBus();
  const sessions = new SessionManager(config, bus, logger.child("sessions"));
  const agents = new AgentStore(config, sessions, bus, logger.child("agents"));
  await agents.load();

  const deps: ApiDeps = {
    config,
    sessions,
    agents,
    bus,
    logger,
    version: VERSION,
    startedAt: new Date().toISOString(),
  };
  const router = buildRouter(deps);

  const server = createServer((req, res) => {
    void handle(req, res, config, router, logger).catch((err) => {
      logger.error("unhandled request failure", { error: String(err) });
      if (!res.headersSent) sendError(res, err);
      else res.destroy();
    });
  });

  // A NAS is often reached over a slow LAN share; the defaults are fine but the
  // SSE stream must not be culled by the idle timer.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 0;

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(config.server.port, config.server.host, () => {
      server.off("error", fail);
      done();
    });
  });

  const url = `http://${formatHost(config.server.host)}:${config.server.port}`;
  logger.info("homespace listening", { url, roots: config.roots.length });

  return {
    server,
    sessions,
    agents,
    bus,
    url,
    async close() {
      await sessions.shutdown();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  config: HomeSpaceConfig,
  router: ReturnType<typeof buildRouter>,
  logger: Logger,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const method = (req.method ?? "GET").toUpperCase();

  const corsOrigin = resolveCorsOrigin(req, config.server.allowedOrigins);
  if (corsOrigin) {
    res.setHeader("access-control-allow-origin", corsOrigin);
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("vary", "origin");
  }
  if (method === "OPTIONS") {
    res.writeHead(corsOrigin ? 204 : 403, {
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": "authorization,content-type",
      "access-control-max-age": "600",
    });
    res.end();
    return;
  }

  // Clickjacking and sniffing defences for the UI; harmless on JSON.
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  res.setHeader("referrer-policy", "no-referrer");

  try {
    if (url.pathname === "/api/health") {
      const matched = router.match(method, url);
      if (matched) {
        await matched.handler({ req, res, params: matched.params, wildcard: matched.wildcard, url, query: url.searchParams });
        return;
      }
    }

    if (url.pathname.startsWith("/api/")) {
      requireAuth(req, url, config.server.token);
      const matched = router.match(method, url);
      if (!matched) {
        throw new HttpError(404, `no route for ${method} ${url.pathname}`);
      }
      await matched.handler({
        req,
        res,
        params: matched.params,
        wildcard: matched.wildcard,
        url,
        query: url.searchParams,
      });
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      throw new HttpError(405, `method ${method} not allowed`);
    }

    if (await serveStatic(res, WEB_ROOT, url.pathname)) return;
    // Client-side routing: unknown non-asset paths get the app shell.
    if (!url.pathname.includes(".") && (await serveStatic(res, WEB_ROOT, "/index.html"))) return;

    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    if (err instanceof PathError) {
      sendError(res, new HttpError(err.status, err.message));
      return;
    }
    if (!(err instanceof HttpError) || err.status >= 500) {
      logger.error("request failed", {
        method,
        path: url.pathname,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    sendError(res, err);
  }
}

function formatHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return "localhost";
  return host.includes(":") ? `[${host}]` : host;
}
