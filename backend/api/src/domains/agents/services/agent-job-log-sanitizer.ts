const SENSITIVE_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|password|cookie|session)/i;
const SENSITIVE_TEXT_PATTERN =
  /\b(api[-_]?key|authorization|token|secret|password)\b\s*[:=]\s*([^\s,;]+)/gi;

const redactValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }

  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(source)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = "[REDACTED]";
        continue;
      }
      out[key] = redactValue(entryValue);
    }
    return out;
  }

  if (typeof value === "string") {
    return value.replace(SENSITIVE_TEXT_PATTERN, (_full, key: string) => `${key}=[REDACTED]`);
  }

  return value;
};

export const sanitizeLogPayload = (payload: unknown): Record<string, unknown> => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return redactValue(payload) as Record<string, unknown>;
};

export const sanitizeLogMessage = (message: string): string => {
  return message.replace(SENSITIVE_TEXT_PATTERN, (_full, key: string) => `${key}=[REDACTED]`);
};
