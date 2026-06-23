import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectsTools } from "../tools/projects.tools";
import { registerBoardsTools } from "../tools/boards.tools";
import { registerWorkItemsTools } from "../tools/work-items.tools";
import { registerTagsTools } from "../tools/tags.tools";
import { registerDocumentsTools } from "../tools/documents.tools";
import { registerSprintsTools } from "../tools/sprints.tools";
import { registerDependenciesTools } from "../tools/dependencies.tools";
import { registerSkillContextTools } from "../tools/skill-context.tools";
import { registerSkillsTools } from "../tools/skills.tools";
import { registerAgentsTools } from "../tools/agents.tools";
import { registerQuotaTools } from "../tools/quota.tools";
import { registerIdeasTools } from "../tools/ideas.tools";
import { registerAuthTools } from "../tools/auth.tools";
import { registerMilestonesTools } from "../tools/milestones.tools";
import { registerMembersTools } from "../tools/members.tools";
import { registerTodosTools } from "../tools/todos.tools";
import { registerSeedsTools } from "../tools/seeds.tools";
import { registerExpensesTools } from "../tools/expenses.tools";
import { registerCommitTools } from "../tools/commits.tools";
import { registerMemoryTools } from "../tools/memory.tools";
import { registerWorkItemMemoryTools } from "../tools/workitem-memory.tools";
import { registerTodoMemoryTools } from "../tools/todo-memory.tools";
import { registerSeedMemoryTools } from "../tools/seed-memory.tools";
import { registerHandbookTools } from "../tools/handbook.tools";
import { registerIntegrationBatchesTools } from "../tools/integration-batches.tools";

/**
 * Registers the public MCP tools (everything except debug/back-office tools).
 * Used as `setupServer` callback for the public `/mcp` mount.
 * Back-office tools (bug-fix-attempts, error-diagnosis, agent-jobs, feedback-triage,
 * feedback-topics) and debug tools are deliberately excluded — they live on
 * `/mcp/internal`.
 */
export const setupPublicMcpServer = async (server: McpServer) => {
  registerProjectsTools(server);
  registerBoardsTools(server);
  registerWorkItemsTools(server);
  registerTagsTools(server);
  registerDocumentsTools(server);
  registerSprintsTools(server);
  registerDependenciesTools(server);
  registerSkillContextTools(server);
  registerSkillsTools(server);
  registerAgentsTools(server);
  registerQuotaTools(server);
  registerIdeasTools(server);
  registerAuthTools(server);
  registerMilestonesTools(server);
  registerMembersTools(server);
  registerTodosTools(server);
  registerSeedsTools(server);
  registerExpensesTools(server);
  registerCommitTools(server);
  registerMemoryTools(server);
  registerWorkItemMemoryTools(server);
  registerTodoMemoryTools(server);
  registerSeedMemoryTools(server);
  registerHandbookTools(server);
  registerIntegrationBatchesTools(server);
};
