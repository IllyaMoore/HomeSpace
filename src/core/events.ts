/**
 * Tiny in-process pub/sub. Every state change worth showing in the UI is
 * published here, and the SSE route at /api/events is the only subscriber that
 * matters — it fans one stream out to every connected browser.
 */

export type HomeSpaceEvent =
  | { type: "session.created"; sessionId: string; agentId: string | null; at: string }
  | { type: "session.status"; sessionId: string; status: string; at: string }
  | { type: "session.message"; sessionId: string; entry: unknown; at: string }
  | { type: "session.closed"; sessionId: string; code: number | null; at: string }
  | { type: "agent.created"; agentId: string; at: string }
  | { type: "agent.updated"; agentId: string; at: string }
  | { type: "agent.deleted"; agentId: string; at: string }
  | { type: "heartbeat"; at: string };

type Listener = (event: HomeSpaceEvent) => void;

export class EventBus {
  #listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  publish(event: HomeSpaceEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // A broken subscriber must never take down the publisher; the SSE
        // route drops itself on write failure.
      }
    }
  }

  get size(): number {
    return this.#listeners.size;
  }
}

export function stamp(): string {
  return new Date().toISOString();
}
