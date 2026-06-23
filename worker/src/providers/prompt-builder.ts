import type { AgentEnvironment, AgentTaskInput } from "./types.js";

const TECH_STACK =
  "Next.js 16 + React 19 + TypeScript + Tailwind CSS 4 + TanStack React Query 5 + Bun/Elysia + Drizzle + PostgreSQL + Better-Auth";

const formatSection = (title: string, body: string) =>
  ["## " + title, body.trim(), ""].join("\n");

const formatKv = (pairs: Array<[string, string | undefined]>) =>
  pairs
    .filter(([, v]) => Boolean(v))
    .map(([k, v]) => `- **${k}**: ${v}`)
    .join("\n");

/**
 * Build a complete, actionable implementation prompt for a coding agent.
 *
 * This function is intentionally "dumb": it assembles a deterministic string
 * from the task + environment. Any provider-specific formatting should be
 * handled in the provider layer.
 */
export const buildImplementationPrompt = (task: AgentTaskInput, env: AgentEnvironment): string => {
  const projectName = "Almirant";
  const repoPath = env.repoPath;

  const taskBlock = [
    formatKv([
      ["Task ID", task.taskId],
      ["Title", task.title],
      ["Type", task.type],
      ["Priority", String(task.priority)],
      ["Work Item ID", task.workItemId],
      ["Repo Path", repoPath],
      ["Branch", env.branchName],
    ]),
    "",
    "### Description",
    task.description?.trim() || "(no description)",
    "",
    "### Definition of Done",
    // DoD is usually embedded in the description, but some work items may add it to metadata.
    typeof task.metadata?.definitionOfDone === "string"
      ? (task.metadata.definitionOfDone as string).trim()
      : "(see task description)",
  ].join("\n");

  const instructions = [
    "1. Read `CLAUDE.md` in the repo root for architecture + conventions.",
    "1. Implement the task exactly as specified by the DoD.",
    "1. Keep the code real (no stubs/dummies) and avoid broad refactors not required by the task.",
    "1. Frontend rules (if you touch frontend):",
    "   - No classes/components-as-classes.",
    "   - Keep business logic in hooks; presentation components should not contain complex logic/hooks.",
    "1. Backend rules:",
    "   - Follow `Route -> Repository -> Drizzle -> PostgreSQL` for API/data changes.",
    "   - Do not execute manual SQL; use Drizzle migrations when schema changes are needed.",
    "1. Do not create commits or PRs. Leave the working tree with the necessary changes only.",
    "1. Run checks before finishing:",
    "   - `cd backend && bun run type-check`",
    "   - `cd frontend && bun run lint && bun run type-check` if frontend changes were made",
  ].join("\n");

  const mcp = [
    "You have access to Almirant MCP tooling to query work items, boards, and dependencies.",
    "If you need more context (e.g., related tasks or existing patterns), fetch it via MCP instead of guessing.",
  ].join("\n");

  const skill = [
    "If your workflow references Almirant agent skills (e.g., implement), follow the repo guidelines:",
    "- Use Bun (no npm/yarn/pnpm).",
    "- Avoid creating unnecessary documentation files.",
  ].join("\n");

  return [
    `# ${projectName} - Implementation Task`,
    "",
    formatSection("Project Context", formatKv([["Project", projectName], ["Tech Stack", TECH_STACK]])),
    formatSection("Task", taskBlock),
    formatSection("Implementation Instructions", instructions),
    formatSection("MCP Access", mcp),
    formatSection("Skill Notes", skill),
  ].join("\n");
};

