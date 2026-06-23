// ---------------------------------------------------------------------------
// Defense-in-depth log sanitizer for the Discord bridge.
//
// The runner already sanitizes content before publishing to the Redis stream.
// This is a secondary filter that catches any residual sensitive data
// before it reaches Discord.
// ---------------------------------------------------------------------------

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/g, label: "ANTHROPIC_KEY" },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, label: "OPENAI_KEY" },
  { pattern: /ghp_[a-zA-Z0-9]{36,}/g, label: "GITHUB_PAT" },
  { pattern: /ghs_[a-zA-Z0-9]{36,}/g, label: "GITHUB_APP_TOKEN" },
  { pattern: /github_pat_[a-zA-Z0-9_]{22,}/g, label: "GITHUB_FINE_PAT" },
  {
    pattern: /[MN][A-Za-z0-9]{23,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g,
    label: "DISCORD_TOKEN",
  },
  { pattern: /xox[bpsar]-[a-zA-Z0-9-]{10,}/g, label: "SLACK_TOKEN" },
  {
    pattern: /eyJ[a-zA-Z0-9_-]{50,}\.[a-zA-Z0-9_-]{50,}\.[a-zA-Z0-9_-]{50,}/g,
    label: "JWT",
  },
  { pattern: /crm_k1_[a-zA-Z0-9]{16,}/g, label: "ALMIRANT_KEY" },
  {
    pattern: /https?:\/\/x-access-token:[^@\s]+@[^\s]+/g,
    label: "GIT_AUTH_URL",
  },
];

export const sanitizeForDiscord = (content: string): string => {
  let result = content;
  for (const { pattern, label } of SENSITIVE_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, `[REDACTED:${label}]`);
  }
  return result;
};
