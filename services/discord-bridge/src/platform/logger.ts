// ---------------------------------------------------------------------------
// Structured logger for the Discord bridge
// ---------------------------------------------------------------------------

export type Logger = (
  level: string,
  message: string,
  meta?: Record<string, unknown>,
) => void;

const LOG_LEVELS: Record<string, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export const createLogger = (configuredLevel: string): Logger => {
  const currentLogLevel = LOG_LEVELS[configuredLevel] ?? 30;

  return (
    level: string,
    message: string,
    meta?: Record<string, unknown>,
  ): void => {
    const numericLevel = LOG_LEVELS[level] ?? 30;
    if (numericLevel < currentLogLevel) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: "discord-bridge",
      message,
      ...meta,
    };

    if (numericLevel >= 50) {
      console.error(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  };
};
