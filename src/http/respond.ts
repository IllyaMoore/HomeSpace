import type { ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload, "utf8"),
    "cache-control": "no-store",
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: err.message, detail: err.detail ?? undefined });
    return;
  }
  const status = typeof (err as { status?: unknown })?.status === "number"
    ? (err as { status: number }).status
    : 500;
  const message = err instanceof Error ? err.message : "internal error";
  sendJson(res, status, { error: message });
}

export function sendNoContent(res: ServerResponse): void {
  if (res.writableEnded) return;
  res.writeHead(204, { "cache-control": "no-store" });
  res.end();
}

export function sendText(res: ServerResponse, status: number, text: string): void {
  if (res.writableEnded) return;
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text, "utf8"),
    "cache-control": "no-store",
  });
  res.end(text);
}
