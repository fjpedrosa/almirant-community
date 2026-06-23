const SECRET_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: "openai-key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { label: "github-token", regex: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { label: "bearer-token", regex: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/gi },
  { label: "openai-api-key-literal", regex: /\bOPENAI_API_KEY\b/g },
  { label: "email", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  {
    label: "basic-auth-url",
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/gi,
  },
];

const SENSITIVE_ENV_KEY = /(KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL|DSN)/i;

export const detectSensitiveContent = (value: string): string[] => {
  const issues = new Set<string>();

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(value)) {
      issues.add(pattern.label);
    }
    pattern.regex.lastIndex = 0;
  }

  for (const [key, envValue] of Object.entries(process.env)) {
    if (!SENSITIVE_ENV_KEY.test(key)) continue;
    if (!envValue || envValue.length < 8) continue;
    if (value.includes(envValue)) {
      issues.add(`env:${key}`);
    }
  }

  return Array.from(issues);
};

export const assertSafeMemoryText = (value: string, field: string) => {
  const issues = detectSensitiveContent(value);
  if (issues.length > 0) {
    throw new Error(
      `Rejected ${field}: sensitive content detected (${issues.join(", ")}).`
    );
  }
  return value;
};

export const assertSafeMemoryPayload = (
  payload: Record<string, unknown> | undefined,
  field = "metadata"
) => {
  if (!payload) return payload;
  const issues = detectSensitiveContent(JSON.stringify(payload));
  if (issues.length > 0) {
    throw new Error(
      `Rejected ${field}: sensitive content detected (${issues.join(", ")}).`
    );
  }
  return payload;
};
