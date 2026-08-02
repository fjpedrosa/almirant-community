/**
 * Console message buffer utility for capturing recent console output.
 * Used by the feedback widget to include console context in bug reports.
 */

const MAX_MESSAGES = 30;
const MAX_ERRORS = 50;

type ConsoleLevel = "log" | "warn" | "error" | "info";

interface ConsoleEntry {
  level: ConsoleLevel;
  message: string;
  timestamp: number;
}

let messageBuffer: ConsoleEntry[] = [];
const errorBuffer: string[] = [];
let isInitialized = false;
let windowErrorHandler: ((event: ErrorEvent) => void) | null = null;
let unhandledRejectionHandler:
  | ((event: PromiseRejectionEvent) => void)
  | null = null;

const originals: Partial<Record<ConsoleLevel, typeof console.log>> = {};

const formatArgs = (args: unknown[]): string =>
  args
    .map((arg) => {
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(" ");

const intercept = (level: ConsoleLevel): void => {
  originals[level] = console[level];

  console[level] = (...args: unknown[]): void => {
    messageBuffer.push({
      level,
      message: formatArgs(args),
      timestamp: Date.now(),
    });
    if (messageBuffer.length > MAX_MESSAGES) {
      messageBuffer.shift();
    }

    originals[level]?.apply(console, args);
  };
};

/**
 * Initializes console interception to capture all levels in a circular buffer.
 * Safe to call multiple times - will only initialize once.
 */
export const initConsoleErrorCapture = (): void => {
  if (typeof window === "undefined" || isInitialized) return;

  intercept("error");
  intercept("warn");
  intercept("log");
  intercept("info");

  // Handler for uncaught exceptions via window.onerror
  windowErrorHandler = (event: ErrorEvent): void => {
    const { message, filename, lineno, colno, error } = event;
    const errorName = error?.name ?? "Error";
    const errorMessage = error?.message ?? message;
    const location =
      filename && lineno ? ` (${filename}:${lineno}:${colno ?? 0})` : "";
    const formatted = `[uncaught] ${errorName}: ${errorMessage}${location}`;

    errorBuffer.push(formatted);
    if (errorBuffer.length > MAX_ERRORS) {
      errorBuffer.shift();
    }
  };

  // Handler for unhandled promise rejections
  unhandledRejectionHandler = (event: PromiseRejectionEvent): void => {
    let reason: string;
    if (event.reason instanceof Error) {
      reason = `${event.reason.name}: ${event.reason.message}`;
    } else if (typeof event.reason === "object" && event.reason !== null) {
      try {
        reason = JSON.stringify(event.reason);
      } catch {
        reason = String(event.reason);
      }
    } else {
      reason = String(event.reason);
    }
    const formatted = `[unhandled-rejection] ${reason}`;

    errorBuffer.push(formatted);
    if (errorBuffer.length > MAX_ERRORS) {
      errorBuffer.shift();
    }
  };

  window.addEventListener("error", windowErrorHandler);
  window.addEventListener("unhandledrejection", unhandledRejectionHandler);

  isInitialized = true;
};

/**
 * Returns recent console messages formatted as `[level] message`.
 */
export const getRecentConsoleErrors = (): string[] => {
  if (typeof window === "undefined") return [];

  return messageBuffer.map(
    (entry) => `[${entry.level}] ${entry.message}`
  );
};

/**
 * Clears the message buffer.
 */
export const clearConsoleErrorBuffer = (): void => {
  messageBuffer = [];
};

/**
 * Cleans up all error capture mechanisms.
 * Restores original console methods and removes window event listeners.
 * Safe to call multiple times (idempotent).
 */
export const destroyConsoleErrorCapture = (): void => {
  // SSR guard
  if (typeof window === "undefined") {
    return;
  }

  // Restore original console methods
  for (const level of Object.keys(originals) as ConsoleLevel[]) {
    if (originals[level]) {
      console[level] = originals[level];
      delete originals[level];
    }
  }

  // Remove window error listener
  if (windowErrorHandler) {
    window.removeEventListener("error", windowErrorHandler);
    windowErrorHandler = null;
  }

  // Remove unhandled rejection listener
  if (unhandledRejectionHandler) {
    window.removeEventListener("unhandledrejection", unhandledRejectionHandler);
    unhandledRejectionHandler = null;
  }

  isInitialized = false;
};
