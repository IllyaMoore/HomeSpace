import { execFile } from "node:child_process";
import { promises as fs, statfsSync } from "node:fs";
import { arch, cpus, freemem, hostname, loadavg, platform, release, totalmem, uptime } from "node:os";
import { promisify } from "node:util";
import type { ContentRoot, HomeSpaceConfig } from "../config.js";

const execFileAsync = promisify(execFile);

export type RootStatus = ContentRoot & {
  /** False when the directory is missing or unreadable — a common NAS symptom
   *  when a share has not been mounted yet. */
  available: boolean;
  error: string | null;
  /** Free/total bytes of the filesystem holding this root, when obtainable. */
  disk: { totalBytes: number; freeBytes: number } | null;
};

export type SystemSnapshot = {
  name: string;
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  uptimeSeconds: number;
  loadAverage: [number, number, number];
  cpu: { model: string; cores: number };
  memory: { totalBytes: number; freeBytes: number; usedPct: number };
  claude: {
    bin: string;
    available: boolean;
    version: string | null;
    defaultModel: string | null;
    defaultPermissionMode: string;
    maxConcurrentSessions: number;
  };
  roots: RootStatus[];
  serverTime: string;
};

/**
 * `claude --version` costs a process spawn, and the answer never changes while
 * the daemon runs. Resolve it once and reuse.
 */
let claudeProbe: Promise<{ available: boolean; version: string | null }> | null = null;

export function probeClaude(bin: string): Promise<{ available: boolean; version: string | null }> {
  // execFile, not exec: a NAS path such as /volume1/@appstore/Node.js/bin/claude
  // must never be handed to a shell for word-splitting.
  claudeProbe ??= execFileAsync(bin, ["--version"], { timeout: 10_000 })
    .then(({ stdout }) => ({ available: true, version: String(stdout).trim() || null }))
    .catch(() => ({ available: false, version: null }));
  return claudeProbe;
}

/** Exposed for tests and for `homespace doctor`, which re-probes deliberately. */
export function resetClaudeProbe(): void {
  claudeProbe = null;
}

function diskFor(path: string): { totalBytes: number; freeBytes: number } | null {
  try {
    const fsStat = statfsSync(path);
    return {
      totalBytes: Number(fsStat.blocks) * Number(fsStat.bsize),
      freeBytes: Number(fsStat.bavail) * Number(fsStat.bsize),
    };
  } catch {
    return null;
  }
}

export async function describeRoot(root: ContentRoot): Promise<RootStatus> {
  try {
    const stat = await fs.stat(root.path);
    if (!stat.isDirectory()) {
      return { ...root, available: false, error: "not a directory", disk: null };
    }
    await fs.access(root.path, fs.constants.R_OK);
    return { ...root, available: true, error: null, disk: diskFor(root.path) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const error =
      code === "ENOENT" ? "path does not exist" : code === "EACCES" ? "permission denied" : String(code ?? err);
    return { ...root, available: false, error, disk: null };
  }
}

export async function snapshot(config: HomeSpaceConfig): Promise<SystemSnapshot> {
  const [claude, roots] = await Promise.all([
    probeClaude(config.claude.bin),
    Promise.all(config.roots.map(describeRoot)),
  ]);

  const total = totalmem();
  const free = freemem();
  const [one = 0, five = 0, fifteen = 0] = loadavg();
  const cpuList = cpus();

  return {
    name: config.name,
    hostname: hostname(),
    platform: platform(),
    release: release(),
    arch: arch(),
    uptimeSeconds: Math.round(uptime()),
    loadAverage: [one, five, fifteen],
    cpu: { model: cpuList[0]?.model?.trim() ?? "unknown", cores: cpuList.length },
    memory: {
      totalBytes: total,
      freeBytes: free,
      usedPct: total ? Math.round(((total - free) / total) * 100) : 0,
    },
    claude: {
      bin: config.claude.bin,
      available: claude.available,
      version: claude.version,
      defaultModel: config.claude.model,
      defaultPermissionMode: config.claude.permissionMode,
      maxConcurrentSessions: config.claude.maxConcurrentSessions,
    },
    roots,
    serverTime: new Date().toISOString(),
  };
}
