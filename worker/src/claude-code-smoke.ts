import { query } from "@anthropic-ai/claude-agent-sdk";

// Compile-time check that the SDK types are available.
export const claudeCodeQueryTypecheck: typeof query = query;
