/**
 * Re-export the canonical internal-skills registry from `@almirant/shared` so
 * the runner and the backend share the SAME source of truth. Never duplicate
 * the list here — the backend enforces security guards against it, so drift
 * would create a silent privilege-escalation window.
 */
export { INTERNAL_MCP_SKILLS, requiresInternalMcp } from "@almirant/shared";
