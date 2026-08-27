import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import type { HomeSpaceConfig, PermissionMode } from "../config.js";
import { PERMISSION_MODES } from "../config.js";
import { EventBus, stamp } from "../core/events.js";
import { newShortId } from "../core/ids.js";
import type { Logger } from "../core/logger.js";
import { findRoot, resolveWithinRoot } from "../core/paths.js";
import { HttpError } from "../http/respond.js";
import type { SessionManager, SessionSummary } from "./sessions.js";

/**
 * An agent is a saved recipe for a Claude Code session: which workspace it runs
 * in, which model, how much it is allowed to do without asking. Starting an
 * agent creates a session bound to it; the agent outlives the session, so the
 * operator can stop and restart the same worker without retyping its setup.
 */
export type Agent = {
  id: string;
  name: string;
  description: string;
  rootId: string;
  /** Workspace directory relative to its root. "" means the root itself. */
  path: string;
  model: string | null;
  permissionMode: PermissionMode;
  /** Appended to Claude Code's default system prompt for this agent. */
  instructions: string;
  allowedTools: string[];
  disallowedTools: string[];
  createdAt: string;
  updatedAt: string;
};

export type AgentView = Agent & {
  /** Absolute workspace path, resolved and checked against the root. */
  workspacePath: string | null;
  /** Null when the workspace is missing or the root is unmounted. */
  workspaceError: string | null;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  status: "idle" | "running" | "working" | "error";
};

export type AgentInput = {
  name?: unknown;
  description?: unknown;
  rootId?: unknown;
  path?: unknown;
  model?: unknown;
  permissionMode?: unknown;
  instructions?: unknown;
  allowedTools?: unknown;
  disallowedTools?: unknown;
};

const MAX_AGENTS = 100;

export class AgentStore {
  #agents = new Map<string, Agent>();
  #file: string;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: HomeSpaceConfig,
    private readonly sessions: SessionManager,
    private readonly bus: EventBus,
    private readonly logger: Logger,
  ) {
    this.#file = join(config.dataDir, "agents.json");
  }

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(this.#file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A corrupt store must not stop the daemon booting. Move it aside so the
      // operator can inspect it and carry on with an empty registry.
      const backup = `${this.#file}.corrupt-${Date.now()}`;
      await fs.rename(this.#file, backup).catch(() => undefined);
      this.logger.error("agents.json was unreadable; moved aside", { backup });
      return;
    }
    if (!Array.isArray(parsed)) return;

    for (const entry of parsed) {
      const agent = coerceStoredAgent(entry);
      if (agent) this.#agents.set(agent.id, agent);
    }
    this.logger.info("loaded agents", { count: this.#agents.size });
  }

  list(): AgentView[] {
    return [...this.#agents.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((agent) => this.#view(agent));
  }

  get(id: string): AgentView {
    const agent = this.#agents.get(id);
    if (!agent) throw new HttpError(404, `agent "${id}" not found`);
    return this.#view(agent);
  }

  async create(input: AgentInput): Promise<AgentView> {
    if (this.#agents.size >= MAX_AGENTS) {
      throw new HttpError(409, `agent limit reached (${MAX_AGENTS})`);
    }
    const fields = await this.#validate(input, null);
    const now = stamp();
    const agent: Agent = { id: newShortId("agent"), ...fields, createdAt: now, updatedAt: now };

    this.#agents.set(agent.id, agent);
    await this.#persist();
    this.bus.publish({ type: "agent.created", agentId: agent.id, at: now });
    return this.#view(agent);
  }

  async update(id: string, input: AgentInput): Promise<AgentView> {
    const existing = this.#agents.get(id);
    if (!existing) throw new HttpError(404, `agent "${id}" not found`);

    const fields = await this.#validate(input, existing);
    const updated: Agent = { ...existing, ...fields, updatedAt: stamp() };

    this.#agents.set(id, updated);
    await this.#persist();
    this.bus.publish({ type: "agent.updated", agentId: id, at: updated.updatedAt });
    return this.#view(updated);
  }

  async remove(id: string): Promise<void> {
    const agent = this.#agents.get(id);
    if (!agent) throw new HttpError(404, `agent "${id}" not found`);

    const live = this.sessions.forAgent(id).filter((s) => s.status !== "exited" && s.status !== "error");
    if (live.length > 0) {
      throw new HttpError(409, `agent has ${live.length} running session(s); stop them first`);
    }
    this.#agents.delete(id);
    await this.#persist();
    this.bus.publish({ type: "agent.deleted", agentId: id, at: stamp() });
  }

  /** Boot a session for this agent, optionally with an opening task. */
  async start(id: string, task?: string): Promise<{ agent: AgentView; session: SessionSummary }> {
    const agent = this.#agents.get(id);
    if (!agent) throw new HttpError(404, `agent "${id}" not found`);

    const root = findRoot(this.config.roots, agent.rootId);
    const resolved = await resolveWithinRoot(root, agent.path);
    await assertDirectory(resolved.absolute);

    let session = this.sessions.start({
      root,
      workspacePath: resolved.absolute,
      title: agent.name,
      model: agent.model,
      permissionMode: agent.permissionMode,
      agentId: agent.id,
      systemPromptAppend: agent.instructions || null,
      allowedTools: agent.allowedTools,
      disallowedTools: agent.disallowedTools,
    });

    if (task?.trim()) {
      session = this.sessions.send(session.id, task.trim());
    }
    return { agent: this.#view(agent), session };
  }

  /**
   * Route a task to the agent's live session, starting one if none is up. This
   * is what the UI's "assign task" button calls — the operator should not have
   * to think about session lifecycle.
   */
  async assign(id: string, task: string): Promise<{ agent: AgentView; session: SessionSummary }> {
    const view = this.get(id);
    const active = view.activeSessionId;
    if (!active) return this.start(id, task);
    return { agent: view, session: this.sessions.send(active, task) };
  }

  async stopAll(id: string): Promise<SessionSummary[]> {
    const view = this.get(id);
    const stopped: SessionSummary[] = [];
    for (const session of view.sessions) {
      if (session.status === "exited" || session.status === "error") continue;
      stopped.push(await this.sessions.stop(session.id));
    }
    return stopped;
  }

  #view(agent: Agent): AgentView {
    const sessions = this.sessions.forAgent(agent.id);
    const live = sessions.find((s) => s.status === "working")
      ?? sessions.find((s) => s.status === "idle" || s.status === "starting");

    let workspacePath: string | null = null;
    let workspaceError: string | null = null;
    const root = this.config.roots.find((r) => r.id === agent.rootId);
    if (!root) {
      workspaceError = `root "${agent.rootId}" is no longer configured`;
    } else {
      // Lexical resolution only — a stat here would make every list call hit
      // the disk once per agent. The full check runs at start().
      workspacePath = resolve(root.path, agent.path);
    }

    const status: AgentView["status"] = live
      ? live.status === "working"
        ? "working"
        : "running"
      : sessions.some((s) => s.status === "error")
        ? "error"
        : "idle";

    return { ...agent, workspacePath, workspaceError, sessions, activeSessionId: live?.id ?? null, status };
  }

  async #validate(input: AgentInput, existing: Agent | null): Promise<Omit<Agent, "id" | "createdAt" | "updatedAt">> {
    const name = readString(input.name, "name", existing?.name, 120);
    if (!name) throw new HttpError(400, `"name" is required`);

    const rootId = readString(input.rootId, "rootId", existing?.rootId, 64);
    if (!rootId) throw new HttpError(400, `"rootId" is required`);
    const root = findRoot(this.config.roots, rootId);
    if (!root.workspace) {
      throw new HttpError(400, `root "${rootId}" is not marked as a workspace in the server config`);
    }

    const path = readString(input.path, "path", existing?.path ?? "", 1024);
    // Validates traversal now, so a bad path is rejected at save time rather
    // than at start time when the operator is expecting the agent to run.
    await resolveWithinRoot(root, path);

    const permissionMode = readEnum(
      input.permissionMode,
      "permissionMode",
      PERMISSION_MODES,
      existing?.permissionMode ?? this.config.claude.permissionMode,
    );

    if (permissionMode === "bypassPermissions" && root.readOnly) {
      throw new HttpError(
        400,
        `root "${rootId}" is read-only; bypassPermissions would let the agent write to it`,
      );
    }

    return {
      name,
      description: readString(input.description, "description", existing?.description ?? "", 500),
      rootId,
      path,
      model: input.model === undefined
        ? (existing?.model ?? this.config.claude.model)
        : input.model === null || input.model === ""
          ? null
          : readString(input.model, "model", null, 120),
      permissionMode,
      instructions: readString(input.instructions, "instructions", existing?.instructions ?? "", 8000),
      allowedTools: readStringArray(input.allowedTools, "allowedTools", existing?.allowedTools ?? []),
      disallowedTools: readStringArray(input.disallowedTools, "disallowedTools", existing?.disallowedTools ?? []),
    };
  }

  /**
   * Serialised, atomic writes. Two concurrent PATCHes would otherwise interleave
   * a read-modify-write and lose one of them; the temp-file rename means a crash
   * mid-write leaves the previous store intact rather than a truncated file.
   */
  #persist(): Promise<void> {
    const snapshot = [...this.#agents.values()];
    this.#writeChain = this.#writeChain.then(async () => {
      await fs.mkdir(this.config.dataDir, { recursive: true, mode: 0o700 });
      const temp = `${this.#file}.${process.pid}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temp, this.#file);
    });
    return this.#writeChain;
  }
}

async function assertDirectory(absolute: string): Promise<void> {
  try {
    const stat = await fs.stat(absolute);
    if (!stat.isDirectory()) throw new HttpError(400, `workspace is not a directory: ${absolute}`);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new HttpError(404, "workspace directory does not exist");
    if (code === "EACCES") throw new HttpError(403, "workspace directory is not readable");
    throw err;
  }
}

function readString(value: unknown, field: string, fallback: string | null | undefined, max: number): string {
  if (value === undefined) return fallback ?? "";
  if (typeof value !== "string") throw new HttpError(400, `"${field}" must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, `"${field}" exceeds ${max} characters`);
  return trimmed;
}

function readEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new HttpError(400, `"${field}" must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function readStringArray(value: unknown, field: string, fallback: string[]): string[] {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value)) throw new HttpError(400, `"${field}" must be an array of strings`);
  return value.map((item, i) => {
    if (typeof item !== "string") throw new HttpError(400, `"${field}[${i}]" must be a string`);
    return item.trim();
  }).filter(Boolean);
}

function coerceStoredAgent(entry: unknown): Agent | null {
  if (typeof entry !== "object" || entry === null) return null;
  const record = entry as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") return null;
  if (typeof record.rootId !== "string") return null;

  const mode = typeof record.permissionMode === "string"
    && (PERMISSION_MODES as readonly string[]).includes(record.permissionMode)
    ? (record.permissionMode as PermissionMode)
    : "manual";

  return {
    id: record.id,
    name: record.name,
    description: typeof record.description === "string" ? record.description : "",
    rootId: record.rootId,
    path: typeof record.path === "string" ? record.path : "",
    model: typeof record.model === "string" ? record.model : null,
    permissionMode: mode,
    instructions: typeof record.instructions === "string" ? record.instructions : "",
    allowedTools: Array.isArray(record.allowedTools)
      ? record.allowedTools.filter((t): t is string => typeof t === "string")
      : [],
    disallowedTools: Array.isArray(record.disallowedTools)
      ? record.disallowedTools.filter((t): t is string => typeof t === "string")
      : [],
    createdAt: typeof record.createdAt === "string" ? record.createdAt : stamp(),
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : stamp(),
  };
}
