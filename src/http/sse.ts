import type { ServerResponse } from "node:http";

/**
 * One browser attached to /api/events. Writes are fire-and-forget: if the
 * socket has gone away the stream closes itself rather than buffering.
 */
export class SseStream {
  #closed = false;
  #heartbeat: NodeJS.Timeout;

  constructor(
    private readonly res: ServerResponse,
    heartbeatMs = 25_000,
  ) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Defeats proxy buffering, which otherwise holds events for minutes.
      "x-accel-buffering": "no",
    });
    // An initial comment flushes headers immediately so the client's
    // `onopen` fires without waiting for the first real event.
    res.write(": connected\n\n");

    this.#heartbeat = setInterval(() => {
      this.comment("ping");
    }, heartbeatMs);
    this.#heartbeat.unref?.();

    res.on("close", () => this.close());
    res.on("error", () => this.close());
  }

  get closed(): boolean {
    return this.#closed;
  }

  send(event: string, data: unknown): void {
    if (this.#closed) return;
    const payload = JSON.stringify(data);
    this.#write(`event: ${event}\ndata: ${payload}\n\n`);
  }

  comment(text: string): void {
    if (this.#closed) return;
    this.#write(`: ${text}\n\n`);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#heartbeat);
    try {
      this.res.end();
    } catch {
      // Socket already torn down.
    }
  }

  #write(chunk: string): void {
    try {
      const ok = this.res.write(chunk);
      if (!ok && this.res.destroyed) this.close();
    } catch {
      this.close();
    }
  }
}
