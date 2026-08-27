import { randomBytes, randomUUID } from "node:crypto";

/** UUID accepted by `claude --session-id`. */
export function newSessionId(): string {
  return randomUUID();
}

/** Short, URL-safe identifier for agents and other user-visible records. */
export function newShortId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

/** Bearer token written into a freshly generated config. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}
