/**
 * Registry of skills that require the privileged `/mcp/internal` mount.
 *
 * This is the CANONICAL source of truth. Both the backend (for creation and
 * token-emission guards) and the runner (for routing MCP URL and session
 * token permissions) must import from here — never duplicate.
 *
 * Adding a skill to this set implicitly grants it access to cross-org
 * back-office tooling (error diagnosis, bug-fix attempts, feedback triage
 * clusters/topics, agent-job inspection). Every addition must be deliberate
 * and reviewed.
 *
 * These skills can ONLY be invoked via internal backend services
 * (feedback-triage-enqueue, bug-analysis-orchestrator, scheduled system jobs).
 * User-facing HTTP endpoints reject them.
 */
export const INTERNAL_MCP_SKILLS: ReadonlySet<string> = new Set([
  "feedback-triage",
  "feedback-triage-batch",
  "feedback-bug-triage",
  "feedback-bug",
  "feedback-bug-analyze",
  "feedback-bug-fix",
  "auto-debug-failed",
]);

/**
 * Returns true when the given skill/promptTemplate slug needs the internal
 * MCP mount. Safe for null/undefined/empty inputs.
 */
export const requiresInternalMcp = (skillName: string | null | undefined): boolean => {
  if (!skillName) return false;
  return INTERNAL_MCP_SKILLS.has(skillName.trim());
};
