export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type Logger = {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
};

function format(scope: string, level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const stamp = new Date().toISOString();
  const tail = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${stamp} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${tail}`;
}

export function createLogger(scope = "homespace", min: LogLevel = "info"): Logger {
  const threshold = LEVEL_ORDER[min];

  const emit = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < threshold) return;
    const line = format(scope, level, message, meta);
    if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  };

  return {
    debug: (m, meta) => emit("debug", m, meta),
    info: (m, meta) => emit("info", m, meta),
    warn: (m, meta) => emit("warn", m, meta),
    error: (m, meta) => emit("error", m, meta),
    child: (childScope) => createLogger(`${scope}:${childScope}`, min),
  };
}
