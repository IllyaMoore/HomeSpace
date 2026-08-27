import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "./respond.js";

export type RouteContext = {
  req: IncomingMessage;
  res: ServerResponse;
  /** Named `:param` segments captured from the pattern. */
  params: Record<string, string>;
  /** Everything matched by a trailing `*`, decoded, with no leading slash. */
  wildcard: string;
  url: URL;
  query: URLSearchParams;
};

export type RouteHandler = (ctx: RouteContext) => void | Promise<void>;

type Route = {
  method: string;
  segments: string[];
  handler: RouteHandler;
};

/**
 * A pattern is a slash-path where a segment may be:
 *   - literal      "/api/files"
 *   - named param  "/api/agents/:agentId"
 *   - wildcard     "/api/files/:rootId/*"   (must be the final segment)
 */
export class Router {
  #routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.#routes.push({
      method: method.toUpperCase(),
      segments: pattern.split("/").filter(Boolean),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: RouteHandler): this {
    return this.add("GET", pattern, handler);
  }
  post(pattern: string, handler: RouteHandler): this {
    return this.add("POST", pattern, handler);
  }
  patch(pattern: string, handler: RouteHandler): this {
    return this.add("PATCH", pattern, handler);
  }
  delete(pattern: string, handler: RouteHandler): this {
    return this.add("DELETE", pattern, handler);
  }

  /**
   * Returns the matched handler plus its bindings, or null when no pattern
   * matches the path at all. When a path matches but the method does not, a 405
   * is thrown so the caller gets a useful answer instead of a bare 404.
   */
  match(method: string, url: URL): { handler: RouteHandler; params: Record<string, string>; wildcard: string } | null {
    const path = url.pathname.split("/").filter(Boolean).map(decodeSegment);
    let pathMatchedWrongMethod = false;

    for (const route of this.#routes) {
      const bound = bind(route.segments, path);
      if (!bound) continue;
      if (route.method !== method.toUpperCase()) {
        pathMatchedWrongMethod = true;
        continue;
      }
      return { handler: route.handler, ...bound };
    }

    if (pathMatchedWrongMethod) {
      throw new HttpError(405, `method ${method} not allowed for ${url.pathname}`);
    }
    return null;
  }
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, "path contains invalid percent-encoding");
  }
}

function bind(
  pattern: string[],
  path: string[],
): { params: Record<string, string>; wildcard: string } | null {
  const params: Record<string, string> = {};

  for (let i = 0; i < pattern.length; i += 1) {
    const spec = pattern[i]!;

    if (spec === "*") {
      // Wildcard soaks up the rest, including nothing at all.
      return { params, wildcard: path.slice(i).join("/") };
    }

    const actual = path[i];
    if (actual === undefined) return null;

    if (spec.startsWith(":")) {
      params[spec.slice(1)] = actual;
      continue;
    }
    if (spec !== actual) return null;
  }

  return path.length === pattern.length ? { params, wildcard: "" } : null;
}
