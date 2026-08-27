import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

/**
 * A directory on the NAS that HomeSpace is allowed to look inside. Everything
 * the file browser and the agents can reach is expressed as a root — there is
 * no way to address a path that does not resolve under one of these.
 */
export type ContentRoot = {
  /** Stable identifier used in API paths: /api/files/<rootId>/... */
  id: string;
  /** Human label shown in the UI sidebar. */
  label: string;
  /** Absolute path on the NAS filesystem. */
  path: string;
  /** When true, agents may be started with this root as their workspace. */
  workspace: boolean;
  /** When true, no handler may modify anything below this root. */
  readOnly: boolean;
};

export type ClaudeConfig = {
  /** Path to (or name of) the Claude Code executable on the NAS. */
  bin: string;
  /** Default model alias for new sessions; null means "whatever the CLI picks". */
  model: string | null;
  /** Default permission mode handed to `claude --permission-mode`. */
  permissionMode: PermissionMode;
  /** Hard ceiling on concurrently running sessions, to protect NAS memory. */
  maxConcurrentSessions: number;
  /** Kill a session that has produced no output for this many milliseconds. */
  idleTimeoutMs: number;
  /** How many transcript entries to keep in memory per session. */
  transcriptLimit: number;
};

export const PERMISSION_MODES = [
  "manual",
  "acceptEdits",
  "auto",
  "plan",
  "dontAsk",
  "bypassPermissions",
] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export type ServerConfig = {
  host: string;
  port: number;
  /**
   * Bearer token every /api/* request must present. Generated on first run and
   * written back to the config file if absent.
   */
  token: string;
  /** Extra origins allowed to call the API from a browser. */
  allowedOrigins: string[];
};

export type HomeSpaceConfig = {
  /** Display name of this NAS, shown in the client's server list. */
  name: string;
  server: ServerConfig;
  roots: ContentRoot[];
  claude: ClaudeConfig;
  /** Where agent definitions and session metadata are persisted. */
  dataDir: string;
};

export class ConfigError extends Error {}

const DEFAULT_CONFIG_PATH = resolve(homedir(), ".homespace", "config.json");

export function defaultConfigPath(): string {
  return process.env.HOMESPACE_CONFIG
    ? resolve(process.env.HOMESPACE_CONFIG)
    : DEFAULT_CONFIG_PATH;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function asString(value: unknown, field: string, fallback?: string): string {
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw new ConfigError(`config: "${field}" is required`);
  }
  if (typeof value !== "string") {
    throw new ConfigError(`config: "${field}" must be a string`);
  }
  return value;
}

function asNumber(value: unknown, field: string, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConfigError(`config: "${field}" must be a number`);
  }
  return value;
}

function asBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    throw new ConfigError(`config: "${field}" must be a boolean`);
  }
  return value;
}

function parseRoots(raw: unknown): ContentRoot[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new ConfigError(`config: "roots" must be an array`);

  const roots: ContentRoot[] = [];
  const seen = new Set<string>();

  for (const [i, entry] of raw.entries()) {
    if (typeof entry !== "object" || entry === null) {
      throw new ConfigError(`config: roots[${i}] must be an object`);
    }
    const record = entry as Record<string, unknown>;
    const path = asString(record.path, `roots[${i}].path`);
    if (!isAbsolute(path)) {
      throw new ConfigError(`config: roots[${i}].path must be absolute (got "${path}")`);
    }
    const label = asString(record.label, `roots[${i}].label`, path);
    const id = slug(asString(record.id, `roots[${i}].id`, label));
    if (!id) throw new ConfigError(`config: roots[${i}].id resolves to an empty slug`);
    if (seen.has(id)) throw new ConfigError(`config: duplicate root id "${id}"`);
    seen.add(id);

    roots.push({
      id,
      label,
      path: resolve(path),
      workspace: asBoolean(record.workspace, `roots[${i}].workspace`, false),
      readOnly: asBoolean(record.readOnly, `roots[${i}].readOnly`, true),
    });
  }
  return roots;
}

function parsePermissionMode(raw: unknown, field: string): PermissionMode {
  const value = asString(raw, field, "manual");
  if (!(PERMISSION_MODES as readonly string[]).includes(value)) {
    throw new ConfigError(
      `config: "${field}" must be one of ${PERMISSION_MODES.join(", ")} (got "${value}")`,
    );
  }
  return value as PermissionMode;
}

export function normalizeConfig(raw: unknown): HomeSpaceConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new ConfigError("config: root value must be an object");
  }
  const record = raw as Record<string, unknown>;
  const server = (record.server ?? {}) as Record<string, unknown>;
  const claude = (record.claude ?? {}) as Record<string, unknown>;

  const token = asString(server.token, "server.token", "");
  if (token && token.length < 16) {
    throw new ConfigError("config: server.token must be at least 16 characters");
  }

  const origins = server.allowedOrigins;
  if (origins !== undefined && !Array.isArray(origins)) {
    throw new ConfigError(`config: "server.allowedOrigins" must be an array`);
  }

  return {
    name: asString(record.name, "name", "HomeSpace NAS"),
    server: {
      host: asString(server.host, "server.host", "127.0.0.1"),
      port: asNumber(server.port, "server.port", 7333),
      token,
      allowedOrigins: (origins ?? []).map((o, i) =>
        asString(o, `server.allowedOrigins[${i}]`),
      ),
    },
    roots: parseRoots(record.roots),
    claude: {
      bin: asString(claude.bin, "claude.bin", "claude"),
      model: claude.model === undefined || claude.model === null
        ? null
        : asString(claude.model, "claude.model"),
      permissionMode: parsePermissionMode(claude.permissionMode, "claude.permissionMode"),
      maxConcurrentSessions: asNumber(
        claude.maxConcurrentSessions,
        "claude.maxConcurrentSessions",
        4,
      ),
      idleTimeoutMs: asNumber(claude.idleTimeoutMs, "claude.idleTimeoutMs", 30 * 60_000),
      transcriptLimit: asNumber(claude.transcriptLimit, "claude.transcriptLimit", 2000),
    },
    dataDir: resolve(
      asString(record.dataDir, "dataDir", resolve(homedir(), ".homespace", "data")),
    ),
  };
}

export async function loadConfig(path = defaultConfigPath()): Promise<HomeSpaceConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ConfigError(
        `no config at ${path} — run \`homespace init\` to create one`,
      );
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`config: ${path} is not valid JSON (${(err as Error).message})`);
  }
  return normalizeConfig(parsed);
}

export async function writeConfig(path: string, config: HomeSpaceConfig): Promise<void> {
  const dir = resolve(path, "..");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}
