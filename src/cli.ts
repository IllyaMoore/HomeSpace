#!/usr/bin/env node
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  ConfigError,
  defaultConfigPath,
  loadConfig,
  normalizeConfig,
  writeConfig,
  type HomeSpaceConfig,
} from "./config.js";
import { newToken } from "./core/ids.js";
import { createLogger, type LogLevel } from "./core/logger.js";
import { createHomeSpaceServer, VERSION } from "./server.js";
import { probeClaude, resetClaudeProbe, snapshot } from "./services/system.js";

const USAGE = `homespace ${VERSION} — NAS control surface for content and Claude Code agents

Usage:
  homespace serve [--config <path>] [--host <h>] [--port <n>] [--log <level>]
  homespace init  [--config <path>] [--root <label>=<path>] [--workspace <label>=<path>]
  homespace token [--config <path>] [--rotate]
  homespace doctor [--config <path>]

Commands:
  serve    Start the daemon (HTTP API + web UI).
  init     Write a starter config with a freshly generated access token.
  token    Print the current access token, or rotate it with --rotate.
  doctor   Check the config, the roots, and whether Claude Code is reachable.

Options:
  --config <path>   Config file (default: $HOMESPACE_CONFIG or ~/.homespace/config.json)
  --host <host>     Override server.host for this run
  --port <port>     Override server.port for this run
  --log <level>     debug | info | warn | error (default: info)
  --root L=P        init: add a read-only content root
  --workspace L=P   init: add a writable root agents may use as a workspace
  -h, --help        Show this help
  -v, --version     Show the version
`;

type Args = {
  command: string;
  config: string;
  host?: string;
  port?: number;
  log: LogLevel;
  rotate: boolean;
  roots: Array<{ label: string; path: string; workspace: boolean }>;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "serve",
    config: defaultConfigPath(),
    log: "info",
    rotate: false,
    roots: [],
  };

  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith("-")) args.command = rest.shift()!;

  while (rest.length > 0) {
    const flag = rest.shift()!;
    const value = () => {
      const next = rest.shift();
      if (next === undefined) throw new ConfigError(`${flag} requires a value`);
      return next;
    };

    switch (flag) {
      case "--config": args.config = resolve(value()); break;
      case "--host": args.host = value(); break;
      case "--port": {
        const port = Number(value());
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new ConfigError("--port must be an integer between 1 and 65535");
        }
        args.port = port;
        break;
      }
      case "--log": {
        const level = value();
        if (!["debug", "info", "warn", "error"].includes(level)) {
          throw new ConfigError("--log must be debug, info, warn or error");
        }
        args.log = level as LogLevel;
        break;
      }
      case "--rotate": args.rotate = true; break;
      case "--root": args.roots.push(parseRootSpec(value(), false)); break;
      case "--workspace": args.roots.push(parseRootSpec(value(), true)); break;
      case "-h": case "--help": args.command = "help"; break;
      case "-v": case "--version": args.command = "version"; break;
      default:
        throw new ConfigError(`unknown option: ${flag}`);
    }
  }
  return args;
}

function parseRootSpec(spec: string, workspace: boolean): { label: string; path: string; workspace: boolean } {
  const at = spec.indexOf("=");
  if (at < 1) throw new ConfigError(`root must look like label=/absolute/path (got "${spec}")`);
  const label = spec.slice(0, at).trim();
  const path = resolve(spec.slice(at + 1).trim());
  if (!label) throw new ConfigError(`root label is empty in "${spec}"`);
  return { label, path, workspace };
}

async function commandInit(args: Args): Promise<void> {
  try {
    await fs.access(args.config);
    console.error(`refusing to overwrite existing config at ${args.config}`);
    console.error("delete it first, or pass --config <other-path>");
    process.exitCode = 1;
    return;
  } catch {
    // Absent, as expected.
  }

  const roots = args.roots.length > 0
    ? args.roots
    : [{ label: "Home", path: homedir(), workspace: true }];

  const config = normalizeConfig({
    name: `HomeSpace on ${(await import("node:os")).hostname()}`,
    server: {
      host: args.host ?? "127.0.0.1",
      port: args.port ?? 7333,
      token: newToken(),
      allowedOrigins: [],
    },
    roots: roots.map((r) => ({
      id: r.label,
      label: r.label,
      path: r.path,
      workspace: r.workspace,
      readOnly: !r.workspace,
    })),
    claude: { bin: "claude" },
  } satisfies Record<string, unknown>);

  await writeConfig(args.config, config);
  console.log(`wrote ${args.config}`);
  console.log(`\naccess token: ${config.server.token}`);
  console.log(`\nroots:`);
  for (const root of config.roots) {
    console.log(`  ${root.id.padEnd(16)} ${root.path}${root.workspace ? "  (workspace)" : "  (read-only)"}`);
  }
  console.log(`\nstart it with:  homespace serve --config ${args.config}`);
  console.log(`bind to the LAN by setting server.host to 0.0.0.0 in the config.`);
}

async function commandToken(args: Args): Promise<void> {
  const config = await loadConfig(args.config);
  if (!args.rotate) {
    console.log(config.server.token);
    return;
  }
  const rotated: HomeSpaceConfig = {
    ...config,
    server: { ...config.server, token: newToken() },
  };
  await writeConfig(args.config, rotated);
  console.log(rotated.server.token);
  console.error("token rotated — restart the daemon and re-pair every client");
}

async function commandDoctor(args: Args): Promise<void> {
  const config = await loadConfig(args.config);
  resetClaudeProbe();
  const snap = await snapshot(config);
  let problems = 0;

  console.log(`config      ${args.config}`);
  console.log(`name        ${snap.name}`);
  console.log(`host        ${snap.hostname} (${snap.platform}/${snap.arch})`);
  console.log(`bind        ${config.server.host}:${config.server.port}`);
  console.log(`data dir    ${config.dataDir}`);
  console.log(`token       ${config.server.token ? "set" : "MISSING"}`);
  if (!config.server.token) problems += 1;

  const claude = snap.claude.available
    ? `ok (${snap.claude.version ?? "version unknown"})`
    : `NOT FOUND — "${config.claude.bin}" is not executable from this daemon`;
  console.log(`claude      ${claude}`);
  if (!snap.claude.available) problems += 1;

  console.log(`roots       ${snap.roots.length}`);
  for (const root of snap.roots) {
    const flags = [root.workspace ? "workspace" : "content", root.readOnly ? "read-only" : "writable"].join(", ");
    const state = root.available ? "ok" : `FAILED: ${root.error}`;
    console.log(`  ${root.id.padEnd(16)} ${state.padEnd(28)} ${flags}  ${root.path}`);
    if (!root.available) problems += 1;
  }
  if (snap.roots.length === 0) {
    console.log("  (none configured — the file browser and agents will have nothing to show)");
    problems += 1;
  }
  if (!snap.roots.some((r) => r.workspace)) {
    console.log("\nno workspace root: agents cannot be started until one root has \"workspace\": true");
    problems += 1;
  }

  console.log(problems === 0 ? "\nall checks passed" : `\n${problems} problem(s) found`);
  if (problems > 0) process.exitCode = 1;
}

async function commandServe(args: Args): Promise<void> {
  const base = await loadConfig(args.config);
  const config: HomeSpaceConfig = {
    ...base,
    server: {
      ...base.server,
      host: args.host ?? base.server.host,
      port: args.port ?? base.server.port,
    },
  };

  if (!config.server.token) {
    throw new ConfigError("server.token is empty — run `homespace token --rotate` to set one");
  }

  const logger = createLogger("homespace", args.log);
  await fs.mkdir(config.dataDir, { recursive: true, mode: 0o700 });

  const probe = await probeClaude(config.claude.bin);
  if (!probe.available) {
    logger.warn(`claude binary "${config.claude.bin}" not found — sessions will fail to start`);
  }

  const instance = await createHomeSpaceServer(config, logger);
  console.log(`\n  HomeSpace ${VERSION} — ${config.name}`);
  console.log(`  ${instance.url}`);
  console.log(`  token: ${config.server.token}\n`);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info(`received ${signal}, shutting down`);
    await instance.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("\n" + USAGE);
    process.exitCode = 2;
    return;
  }

  try {
    switch (args.command) {
      case "help": console.log(USAGE); return;
      case "version": console.log(VERSION); return;
      case "init": await commandInit(args); return;
      case "token": await commandToken(args); return;
      case "doctor": await commandDoctor(args); return;
      case "serve": await commandServe(args); return;
      default:
        console.error(`unknown command: ${args.command}\n`);
        console.error(USAGE);
        process.exitCode = 2;
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exitCode = 1;
      return;
    }
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  }
}

void main();
