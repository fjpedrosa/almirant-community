/**
 * Sanitizes log output by redacting sensitive patterns.
 * Defense-in-depth: primary defense is removing secrets from containers.
 * This filter catches any residual exposure in agent output.
 */

// API key patterns
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Anthropic API keys
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, label: "ANTHROPIC_KEY" },
  // OpenAI API keys
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, label: "OPENAI_KEY" },
  // GitHub tokens
  { pattern: /ghp_[a-zA-Z0-9]{36,}/g, label: "GITHUB_PAT" },
  { pattern: /ghs_[a-zA-Z0-9]{36,}/g, label: "GITHUB_APP_TOKEN" },
  {
    pattern: /github_pat_[a-zA-Z0-9_]{22,}/g,
    label: "GITHUB_FINE_PAT",
  },
  // Discord bot tokens (format: MTk...base64)
  {
    pattern:
      /[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g,
    label: "DISCORD_TOKEN",
  },
  // Slack tokens
  { pattern: /xox[bpsar]-[a-zA-Z0-9-]{10,}/g, label: "SLACK_TOKEN" },
  // Generic long base64 tokens (potential JWTs or API keys) - only match very long ones
  {
    pattern:
      /eyJ[a-zA-Z0-9_-]{50,}\.[a-zA-Z0-9_-]{50,}\.[a-zA-Z0-9_-]{50,}/g,
    label: "JWT",
  },
  // Almirant API keys (crm_k1_ prefix)
  { pattern: /crm_k1_[a-zA-Z0-9]{16,}/g, label: "ALMIRANT_KEY" },
  // Generic x-access-token in URLs
  {
    pattern: /https?:\/\/x-access-token:[^@\s]+@[^\s]+/g,
    label: "GIT_AUTH_URL",
  },
];

// Detect env dump lines (KEY=value format)
const ENV_LINE_PATTERN = /^[A-Z_]{2,}[A-Z0-9_]*=.+$/;
const SENSITIVE_ENV_KEYS = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GIT_TOKEN",
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GITHUB_API_TOKEN",
  "DISCORD_BOT_TOKEN",
  "ALMIRANT_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_AUTH_TOKEN",
  "CODEX_AUTH_JSON",
  "__GIT_CLONE_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "DATABASE_URL",
]);

export function sanitizeLogContent(content: string): string {
  let result = content;

  // Replace known API key patterns
  for (const { pattern, label } of SENSITIVE_PATTERNS) {
    // Reset lastIndex since we reuse global regexes across calls
    pattern.lastIndex = 0;
    result = result.replace(pattern, `[REDACTED:${label}]`);
  }

  // Redact sensitive env var lines
  const lines = result.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ENV_LINE_PATTERN.test(line)) {
      const eqIndex = line.indexOf("=");
      if (eqIndex > 0) {
        const key = line.slice(0, eqIndex);
        if (SENSITIVE_ENV_KEYS.has(key)) {
          lines[i] = `${key}=[REDACTED]`;
        }
      }
    }
  }

  return lines.join("\n");
}
