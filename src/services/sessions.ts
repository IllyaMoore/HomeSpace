import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ContentRoot, HomeSpaceConfig, PermissionMode } from "../config.js";
import { EventBus, stamp } from "../core/events.js";
import { newSessionId } from "../core/ids.js";
import type { Logger } from "../core/logger.js";
import { HttpError } from "../http/respond.js";
import {
  NdjsonParser,
  isTurnEnd,
  toTranscriptEntries,
  type TokenUsage,
  type TranscriptEntry,
} from "./claude-events.js";

export type SessionStatus = "starting" | "idle" | "working" | "exited" | "error";

export type SessionSummary = {
  id: string;
  /** The `--session-id` handed to the CLI, for `claude --resume` from a shell. */
  claudeSessionId: string;
  agentId: string | null;
  title: string;
  status: SessionStatus;
  rootId: string;
  workspacePath: string;
  model: string | null;
  permissionMode: PermissionMode;
  createdAt: string;
  lastActivityAt: string;
  turns: number;
  entryCount: number;
  usage: TokenUsage;
  costUsd: number;
  exitCode: number | null;
  lastError: string | null;
};

export type StartOptions = {
  root: ContentRoot;
  /** Workspace directory as an absolute path already validated against `root`. */
  workspacePath: string;
  title?: string;
  model?: string | null;
  permissionMode?: PermissionMode;
  agentId?: string | null;
  systemPromptAppend?: string | null;
  allowedTools?: string[];
  disallowedTools?: string[];
};

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

class Session {
  readonly id: string;
  readonly claudeSessionId: string;
  readonly createdAt = stamp();
  readonly transcript: TranscriptEntry[] = [];

  status: SessionStatus = "starting";
  lastActivityAt = stamp();
  turns = 0;
  usage: TokenUsage = { ...EMPTY_USAGE };
  costUsd = 0;
  exitCode: number | null = null;
  lastError: string | null = null;
  model: string | null;

  #seq = 0;
  #child: ChildProcessWithoutNullStreams | null = null;
  #stdout = new NdjsonParser();
  #stderrTail: string[] = [];
  #idleTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly title: string,
    readonly agentId: string | null,
    readonly options: StartOptions,
    private readonly config: HomeSpaceConfig,
    private readonly bus: EventBus,
    private readonly logger: Logger,
    private readonly onExit: (session: Session) => void,
  ) {
    this.id = newSessionId();
    this.claudeSessionId = randomUUID();
    this.model = options.model ?? config.claude.model;
  }

  get permissionMode(): PermissionMode {
    return this.options.permissionMode ?? this.config.claude.permissionMode;
  }

  get running(): boolean {
    return this.#child !== null && this.#child.exitCode === null && !this.#child.killed;
  }

  summary(): SessionSummary {
    return {
      id: this.id,
      claudeSessionId: this.claudeSessionId,
      agentId: this.agentId,
      title: this.title,
      status: this.status,
      rootId: this.options.root.id,
      workspacePath: this.options.workspacePath,
      model: this.model,
      permissionMode: this.permissionMode,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      turns: this.turns,
      entryCount: this.transcript.length,
      usage: this.usage,
      costUsd: this.costUsd,
      exitCode: this.exitCode,
      lastError: this.lastError,
    };
  }

  buildArgs(): string[] {
    const args = [
      "--print",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      // stream-json output is rejected without --verbose; the CLI enforces it.
      "--verbose",
      "--session-id", this.claudeSessionId,
      "--permission-mode", this.permissionMode,
      "--add-dir", this.options.workspacePath,
    ];
    if (this.model) args.push("--model", this.model);
    if (this.options.systemPromptAppend) {
      args.push("--append-system-prompt", this.options.systemPromptAppend);
    }
    if (this.options.allowedTools?.length) {
      args.push("--allowed-tools", this.options.allowedTools.join(","));
    }
    if (this.options.disallowedTools?.length) {
      args.push("--disallowed-tools", this.options.disallowedTools.join(","));
    }
    return args;
  }

  start(): void {
    const args = this.buildArgs();
    this.logger.info("spawning claude", {
      sessionId: this.id,
      cwd: this.options.workspacePath,
      model: this.model,
      permissionMode: this.permissionMode,
    });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.config.claude.bin, args, {
        cwd: this.options.workspacePath,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          // The CLI renders differently when it believes it is on a terminal;
          // pin it to the plain, parseable path.
          CI: "1",
          TERM: "dumb",
          FORCE_COLOR: "0",
        },
      });
    } catch (err) {
      this.#fail(`failed to spawn ${this.config.claude.bin}: ${(err as Error).message}`);
      return;
    }

    this.#child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => this.#ingest(chunk));
    child.stderr.on("data", (chunk: string) => this.#ingestStderr(chunk));

    child.on("error", (err) => {
      this.#fail(`claude process error: ${err.message}`);
    });

    child.on("close", (code) => {
      for (const payload of this.#stdout.flush()) this.#handlePayload(payload);
      this.exitCode = code;
      this.#clearIdleTimer();
      // A non-zero exit with no result event means the CLI died on us — surface
      // the tail of stderr, which is where the reason always is.
      if (code !== 0 && code !== null && !this.lastError) {
        this.lastError = this.#stderrTail.join("").trim().slice(-2000) || `claude exited with code ${code}`;
        this.#setStatus("error");
      } else if (this.status !== "error") {
        this.#setStatus("exited");
      }
      this.bus.publish({ type: "session.closed", sessionId: this.id, code, at: stamp() });
      this.logger.info("claude exited", { sessionId: this.id, code });
      this.onExit(this);
    });

    this.#setStatus("idle");
    this.#armIdleTimer();
  }

  /** Queue a prompt. The CLI processes stdin messages in order. */
  send(text: string): void {
    if (!this.running || !this.#child) {
      throw new HttpError(409, `session ${this.id} is not running`);
    }
    const message = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    };
    this.#record({ seq: this.#nextSeq(), at: stamp(), kind: "user", text });
    this.#child.stdin.write(`${JSON.stringify(message)}\n`, (err) => {
      if (err) this.#fail(`failed to write to claude stdin: ${err.message}`);
    });
    this.turns += 1;
    this.#setStatus("working");
    this.#armIdleTimer();
  }

  /**
   * Asks the CLI to abandon the current turn using the SDK control protocol.
   * The process stays alive, so the session can take a new prompt afterwards.
   */
  interrupt(): void {
    if (!this.running || !this.#child) {
      throw new HttpError(409, `session ${this.id} is not running`);
    }
    const request = {
      type: "control_request",
      request_id: randomUUID(),
      request: { subtype: "interrupt" },
    };
    this.#child.stdin.write(`${JSON.stringify(request)}\n`);
    this.#note("warn", "interrupt requested");
  }

  /** SIGTERM, then SIGKILL if the process has not gone within the grace period. */
  async stop(graceMs = 5_000): Promise<void> {
    const child = this.#child;
    if (!child || !this.running) return;

    this.#clearIdleTimer();
    try {
      child.stdin.end();
    } catch {
      // Already closed.
    }
    child.kill("SIGTERM");

    await new Promise<void>((done) => {
      const timer = setTimeout(() => {
        if (this.running) {
          this.logger.warn("claude ignored SIGTERM, sending SIGKILL", { sessionId: this.id });
          child.kill("SIGKILL");
        }
        done();
      }, graceMs);
      timer.unref?.();
      child.once("close", () => {
        clearTimeout(timer);
        done();
      });
    });
  }

  #ingest(chunk: string): void {
    for (const payload of this.#stdout.push(chunk)) this.#handlePayload(payload);
  }

  #handlePayload(payload: unknown): void {
    this.lastActivityAt = stamp();
    this.#armIdleTimer();

    const typed = payload as { type?: unknown; text?: unknown };

    // A non-JSON diagnostic line the parser wrapped for us.
    if (typed?.type === "__text__") {
      this.#note("info", String(typed.text ?? ""));
      return;
    }

    // The CLI emits ~30 partial-token frames per turn even without
    // --include-partial-messages. They carry no information the transcript does
    // not already get from the finished assistant message, and the "working"
    // badge already conveys liveness — so they are dropped here rather than
    // pushed down every open SSE stream on the LAN.
    if (typed?.type === "stream_event") return;

    for (const entry of toTranscriptEntries(payload, () => this.#nextSeq())) {
      if (entry.kind === "init") {
        this.model = entry.model ?? this.model;
      }
      if (entry.kind === "result") {
        this.#applyResult(entry);
      }
      this.#record(entry);
    }

    if (isTurnEnd(payload)) {
      this.#setStatus(this.status === "error" ? "error" : "idle");
    }
  }

  #applyResult(entry: Extract<TranscriptEntry, { kind: "result" }>): void {
    if (entry.usage) {
      this.usage = {
        inputTokens: this.usage.inputTokens + entry.usage.inputTokens,
        outputTokens: this.usage.outputTokens + entry.usage.outputTokens,
        cacheReadTokens: this.usage.cacheReadTokens + entry.usage.cacheReadTokens,
        cacheCreationTokens: this.usage.cacheCreationTokens + entry.usage.cacheCreationTokens,
      };
    }
    if (typeof entry.costUsd === "number") this.costUsd += entry.costUsd;
    if (entry.isError) {
      this.lastError = entry.text ?? entry.subtype;
    }
  }

  #ingestStderr(chunk: string): void {
    this.#stderrTail.push(chunk);
    // Keep the tail bounded — a chatty CLI must not grow the heap forever.
    if (this.#stderrTail.length > 50) this.#stderrTail.splice(0, this.#stderrTail.length - 50);
    const trimmed = chunk.trim();
    if (trimmed) this.logger.debug("claude stderr", { sessionId: this.id, chunk: trimmed.slice(0, 500) });
  }

  #note(level: "info" | "warn" | "error", text: string): void {
    this.#record({ seq: this.#nextSeq(), at: stamp(), kind: "notice", level, text });
  }

  #record(entry: TranscriptEntry): void {
    this.transcript.push(entry);
    const overflow = this.transcript.length - this.config.claude.transcriptLimit;
    if (overflow > 0) this.transcript.splice(0, overflow);
    this.lastActivityAt = entry.at;
    this.bus.publish({ type: "session.message", sessionId: this.id, entry, at: entry.at });
  }

  #setStatus(status: SessionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.bus.publish({ type: "session.status", sessionId: this.id, status, at: stamp() });
  }

  #fail(message: string): void {
    this.lastError = message;
    this.#setStatus("error");
    this.logger.error(message, { sessionId: this.id });
    this.#note("error", message);
  }

  #nextSeq(): number {
    this.#seq += 1;
    return this.#seq;
  }

  #armIdleTimer(): void {
    this.#clearIdleTimer();
    const timeout = this.config.claude.idleTimeoutMs;
    if (timeout <= 0) return;
    this.#idleTimer = setTimeout(() => {
      this.logger.info("closing idle session", { sessionId: this.id, idleMs: timeout });
      this.#note("warn", `closed after ${Math.round(timeout / 60000)} minutes idle`);
      void this.stop();
    }, timeout);
    this.#idleTimer.unref?.();
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
  }
}

export class SessionManager {
  #sessions = new Map<string, Session>();

  constructor(
    private readonly config: HomeSpaceConfig,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {}

  list(): SessionSummary[] {
    return [...this.#sessions.values()]
      .map((s) => s.summary())
      .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
  }

  get(id: string): Session {
    const session = this.#sessions.get(id);
    if (!session) throw new HttpError(404, `session "${id}" not found`);
    return session;
  }

  summary(id: string): SessionSummary {
    return this.get(id).summary();
  }

  transcript(id: string, opts: { since?: number; limit?: number } = {}): TranscriptEntry[] {
    const entries = this.get(id).transcript;
    const since = opts.since ?? 0;
    const filtered = since > 0 ? entries.filter((e) => e.seq > since) : entries;
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 5000);
    return filtered.slice(-limit);
  }

  start(options: StartOptions): SessionSummary {
    const live = [...this.#sessions.values()].filter((s) => s.running).length;
    if (live >= this.config.claude.maxConcurrentSessions) {
      throw new HttpError(
        429,
        `session limit reached (${this.config.claude.maxConcurrentSessions} running); stop one first`,
      );
    }
    if (!options.root.workspace) {
      throw new HttpError(403, `root "${options.root.id}" is not marked as a workspace`);
    }

    const title = options.title?.trim() || `${options.root.label} session`;
    const session = new Session(
      title,
      options.agentId ?? null,
      options,
      this.config,
      this.bus,
      this.logger.child("session"),
      (closed) => this.#reap(closed),
    );

    this.#sessions.set(session.id, session);
    this.bus.publish({
      type: "session.created",
      sessionId: session.id,
      agentId: session.agentId,
      at: stamp(),
    });
    session.start();
    return session.summary();
  }

  send(id: string, text: string): SessionSummary {
    const session = this.get(id);
    session.send(text);
    return session.summary();
  }

  interrupt(id: string): SessionSummary {
    const session = this.get(id);
    session.interrupt();
    return session.summary();
  }

  async stop(id: string): Promise<SessionSummary> {
    const session = this.get(id);
    await session.stop();
    return session.summary();
  }

  /** Forget an already-exited session and its transcript. */
  remove(id: string): void {
    const session = this.get(id);
    if (session.running) {
      throw new HttpError(409, "session is still running; stop it first");
    }
    this.#sessions.delete(id);
  }

  forAgent(agentId: string): SessionSummary[] {
    return this.list().filter((s) => s.agentId === agentId);
  }

  /** Stop every session — used on SIGINT/SIGTERM so no orphan CLI survives. */
  async shutdown(): Promise<void> {
    await Promise.all([...this.#sessions.values()].map((s) => s.stop(2_000)));
  }

  #reap(session: Session): void {
    // Exited sessions stay in the map so their transcript remains readable.
    // They are only evicted once the count of dead sessions gets silly.
    const dead = [...this.#sessions.values()].filter((s) => !s.running);
    if (dead.length <= 20) return;
    dead
      .sort((a, b) => Date.parse(a.lastActivityAt) - Date.parse(b.lastActivityAt))
      .slice(0, dead.length - 20)
      .forEach((old) => this.#sessions.delete(old.id));
    this.logger.debug("reaped old sessions", { keptAfter: session.id });
  }
}
