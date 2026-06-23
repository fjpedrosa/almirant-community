import { env } from "./env";

type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

const LEVELS: Record<LogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

const threshold = LEVELS[env.LOG_LEVEL];

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= threshold;
}

// ── ANSI colors ──

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgYellow: "\x1b[43m",
} as const;

const LEVEL_STYLE: Record<LogLevel, string> = {
  fatal: `${c.bgRed}${c.white}${c.bold} FATAL ${c.reset}`,
  error: `${c.red}${c.bold}ERROR${c.reset}`,
  warn: `${c.yellow}WARN${c.reset} `,
  info: `${c.cyan}INFO${c.reset} `,
  debug: `${c.dim}DEBUG${c.reset}`,
  trace: `${c.dim}TRACE${c.reset}`,
};

export function colorStatus(status: number): string {
  if (status < 300) return `${c.green}${status}${c.reset}`;
  if (status < 400) return `${c.cyan}${status}${c.reset}`;
  if (status < 500) return `${c.yellow}${status}${c.reset}`;
  return `${c.red}${c.bold}${status}${c.reset}`;
}

export function colorMethod(method: string): string {
  const padded = method.padEnd(7);
  switch (method) {
    case "GET":
      return `${c.cyan}${padded}${c.reset}`;
    case "POST":
      return `${c.green}${padded}${c.reset}`;
    case "PUT":
    case "PATCH":
      return `${c.yellow}${padded}${c.reset}`;
    case "DELETE":
      return `${c.red}${padded}${c.reset}`;
    default:
      return `${c.dim}${padded}${c.reset}`;
  }
}

export function colorDuration(ms: number): string {
  if (ms < 100) return `${c.dim}${ms}ms${c.reset}`;
  if (ms < 500) return `${c.yellow}${ms}ms${c.reset}`;
  return `${c.red}${c.bold}${ms}ms${c.reset}`;
}

// ── Formatting ──

// Handles Pino-style call signatures:
//   logger.info("message")
//   logger.info({ key: "val" }, "message")
//   logger.error(err, "message")
function formatArgs(args: unknown[]): string {
  if (args.length === 1) return String(args[0]);

  if (args.length === 2 && typeof args[1] === "string") {
    const ctx = args[0];

    if (ctx instanceof Error) return `${args[1]}: ${ctx.message}`;

    if (typeof ctx === "object" && ctx !== null) {
      const flat = Object.entries(ctx as Record<string, unknown>)
        .filter(([k]) => k !== "err")
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(" ");
      const err = (ctx as Record<string, unknown>).err;
      const errMsg = err instanceof Error ? `: ${err.message}` : "";
      return flat
        ? `${args[1]} ${c.dim}${flat}${c.reset}${errMsg}`
        : `${args[1]}${errMsg}`;
    }

    return `${args[1]} ${args[0]}`;
  }

  return args.map(String).join(" ");
}

function timestamp(): string {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${c.dim}${h}:${m}:${s}${c.reset}`;
}

function log(level: LogLevel, args: unknown[]): void {
  if (!shouldLog(level)) return;
  const prefix = `${timestamp()} ${LEVEL_STYLE[level]}`;
  const message = formatArgs(args);
  const out = level === "error" || level === "fatal" ? console.error : level === "warn" ? console.warn : console.log;
  out(`${prefix} ${message}`);
}

export const logger = {
  fatal: (...args: unknown[]) => log("fatal", args),
  error: (...args: unknown[]) => log("error", args),
  warn: (...args: unknown[]) => log("warn", args),
  info: (...args: unknown[]) => log("info", args),
  debug: (...args: unknown[]) => log("debug", args),
  trace: (...args: unknown[]) => log("trace", args),
};

export type Logger = typeof logger;
