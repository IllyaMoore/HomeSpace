import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { HttpError } from "./respond.js";

/**
 * Constant-time comparison that does not leak length. Comparing raw buffers with
 * `timingSafeEqual` throws when lengths differ, which itself is an oracle — so
 * both sides are padded to a fixed width first.
 */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.alloc(64);
  const right = Buffer.alloc(64);
  left.write(a.slice(0, 64), "utf8");
  right.write(b.slice(0, 64), "utf8");
  return timingSafeEqual(left, right) && a.length === b.length;
}

/**
 * Accepts the token from either an `Authorization: Bearer` header or a
 * `?token=` query parameter. The query form exists only because `EventSource`
 * cannot set headers — every other route should use the header.
 */
export function extractToken(req: IncomingMessage, url: URL): string | null {
  const header = req.headers.authorization;
  if (typeof header === "string") {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  const query = url.searchParams.get("token");
  if (query) return query;
  return null;
}

export function requireAuth(req: IncomingMessage, url: URL, expected: string): void {
  if (!expected) {
    throw new HttpError(500, "server has no token configured; refusing all requests");
  }
  const presented = extractToken(req, url);
  if (!presented || !tokensMatch(presented, expected)) {
    throw new HttpError(401, "invalid or missing bearer token");
  }
}

/**
 * A NAS box is on a LAN with other devices and browsers. Only origins the
 * operator listed may make credentialed cross-origin calls; same-origin
 * requests (no Origin header, or an Origin equal to the server's own) always
 * pass.
 */
export function resolveCorsOrigin(
  req: IncomingMessage,
  allowed: string[],
): string | null {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || origin === "") return null;
  if (allowed.includes("*")) return origin;
  return allowed.includes(origin) ? origin : null;
}
