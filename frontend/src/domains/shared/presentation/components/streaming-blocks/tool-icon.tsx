import {
  Eye,
  Pencil,
  FilePlus,
  Terminal,
  Search,
  FolderSearch,
  Bot,
  Globe,
  Wrench,
  FileText,
  Code,
  GitBranch,
  Github,
  NotebookPen,
  Sparkles,
  LayoutList,
  Package,
  FlaskConical,
  ShieldCheck,
  CalendarClock,
} from "lucide-react";
import { McpIcon } from "@/components/icons/mcp-icon";

const TOOL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  // Claude Code built-in tools
  Read: Eye,
  Write: FilePlus,
  Edit: Pencil,
  Bash: Terminal,
  Grep: Search,
  Glob: FolderSearch,
  Git: GitBranch,
  GitHub: Github,
  Install: Package,
  Test: FlaskConical,
  Lint: Search,
  TypeCheck: ShieldCheck,
  Env: Terminal,
  Date: CalendarClock,
  Agent: Bot,
  Task: Bot,
  WebSearch: Globe,
  WebFetch: Globe,
  Skill: Code,
  skill: Code,
  ToolSearch: Search,
  NotebookEdit: NotebookPen,
  LSP: FileText,
  // Task management tools
  TodoWrite: LayoutList,
  TaskCreate: LayoutList,
  TaskUpdate: LayoutList,
  TaskGet: LayoutList,
  TaskList: LayoutList,
  TaskStop: LayoutList,
  TaskOutput: LayoutList,
  // Plan mode tools
  EnterPlanMode: Sparkles,
  ExitPlanMode: Sparkles,
  // Agent communication
  SendMessage: Bot,
};

/** Human-friendly display name for tool calls. */
const TOOL_NAME_MAP: Record<string, string> = {
  mcp_tool: "MCP tool",
  skill: "Skill",
  ToolSearch: "Search",
  WebSearch: "Web",
  WebFetch: "Fetch",
  NotebookEdit: "Notebook",
  AskUserQuestion: "Interactive questionnaire",
  // Task management
  TodoWrite: "Update tasks",
  TaskCreate: "Create task",
  TaskUpdate: "Update task",
  TaskGet: "Task status",
  TaskList: "List tasks",
  TaskStop: "Stop task",
  TaskOutput: "Task output",
  // Plan mode
  EnterPlanMode: "Plan mode",
  ExitPlanMode: "Exit plan mode",
  // Agent communication
  SendMessage: "Message agent",
  TypeCheck: "Type check",
};

/** Human-friendly names for known MCP tool actions. */
const MCP_ACTION_LABELS: Record<string, string> = {
  // Skill context
  get_ideation_context: "Ideation context",
  get_board_context: "Board context",
  get_implement_context: "Implementation context",
  get_validate_context: "Validation context",
  get_review_context: "Review context",
  get_document_context: "Documentation context",
  get_record_video_context: "Recording context",
  resolve_work_items: "Resolve work items",
  batch_move_work_items: "Batch move items",
  get_dependencies_batch: "Get dependencies",
  // Work items
  list_work_items: "List work items",
  get_work_item: "Get work item",
  create_work_item: "Create work item",
  create_task: "Create task",
  create_story: "Create story",
  create_feature: "Create feature",
  create_epic: "Create epic",
  update_work_item: "Update work item",
  delete_work_item: "Delete work item",
  move_work_item: "Move work item",
  generate_work_item_prompt: "Generate prompt",
  get_work_item_prompt: "Get prompt",
  complete_review: "Complete review",
  complete_validation: "Complete validation",
  complete_validation_fail: "Validation failed",
  complete_documentation: "Complete documentation",
  complete_ai_task: "Complete AI task",
  upload_work_item_attachment: "Upload attachment",
  upload_walkthrough_video: "Upload video",
  get_work_item_events: "Item history",
  get_work_item_dependencies: "Item dependencies",
  add_work_item_dependency: "Add dependency",
  remove_work_item_dependency: "Remove dependency",
  record_ai_session: "Record AI session",
  get_ai_sessions: "AI sessions",
  list_work_item_comments: "Item comments",
  add_work_item_comment: "Add comment",
  set_implementation_outcomes: "Implementation outcomes",
  link_commit_to_work_item: "Link commit",
  // Boards
  get_board: "Get board",
  list_boards: "List boards",
  // Projects
  get_project: "Get project",
  list_projects: "List projects",
  create_project: "Create project",
  update_project: "Update project",
  get_project_roadmap: "Project roadmap",
  // Seeds
  create_seed: "Create seed",
  get_seed: "Get seed",
  list_seeds: "List seeds",
  update_seed: "Update seed",
  delete_seed: "Delete seed",
  set_seed_status: "Seed status",
  get_seeds_for_ideation: "Seeds for ideation",
  mark_seeds_as_used: "Mark seeds as used",
  promote_seed: "Promote seed",
  add_tag_to_seed: "Tag seed",
  remove_tag_from_seed: "Remove seed tag",
  list_seed_tags: "Seed tags",
  list_seed_comments: "Seed comments",
  add_seed_comment: "Comment on seed",
  // Ideas
  create_idea_item: "Create idea",
  list_idea_items: "List ideas",
  get_idea_item: "Get idea",
  update_idea_item: "Update idea",
  delete_idea_item: "Delete idea",
  set_idea_item_status: "Idea status",
  assign_idea_item_owner: "Assign idea",
  set_idea_item_due_date: "Idea due date",
  toggle_idea_item_discussed: "Mark as discussed",
  promote_idea_item: "Promote idea",
  get_idea_item_traceability: "Idea traceability",
  link_feedback_to_idea_item: "Link feedback",
  unlink_feedback_from_idea_item: "Unlink feedback",
  list_idea_comments: "Idea comments",
  add_idea_comment: "Comment on idea",
  add_tag_to_idea_item: "Tag idea",
  remove_tag_from_idea_item: "Remove idea tag",
  list_idea_item_tags: "Idea tags",
  // Sprints
  list_sprints: "List sprints",
  get_sprint: "Get sprint",
  get_active_sprint: "Active sprint",
  create_sprint: "Create sprint",
  close_sprint: "Close sprint",
  close_sprint_adhoc: "Close sprint ad-hoc",
  close_sprint_by_date: "Close sprint by date",
  get_sprint_work_items: "Sprint items",
  preview_done_items: "Preview done items",
  regenerate_sprint_changelog: "Regenerate changelog",
  // Milestones
  list_milestones: "List milestones",
  get_milestone: "Get milestone",
  get_milestone_progress: "Milestone progress",
  create_milestone: "Create milestone",
  update_milestone: "Update milestone",
  delete_milestone: "Delete milestone",
  add_work_items_to_milestone: "Add items to milestone",
  remove_work_item_from_milestone: "Remove item from milestone",
  // Todos
  list_todo_items: "List todo items",
  get_todo_item: "Get todo item",
  create_todo_item: "Create todo item",
  update_todo_item: "Update todo item",
  delete_todo_item: "Delete todo item",
  set_todo_item_status: "Todo item status",
  assign_todo_item_owner: "Assign todo item",
  set_todo_item_due_date: "Todo due date",
  list_todo_comments: "Todo comments",
  add_todo_comment: "Comment on todo",
  // Auth
  get_current_user: "Current user",
  // Members
  list_members: "List members",
  // Tags
  list_tags: "List tags",
  create_tag: "Create tag",
  delete_tag: "Delete tag",
  // Quota
  check_quota: "Check quota",
  get_quota_usage: "Quota usage",
  // Documents
  list_documents: "List documents",
  list_document_categories: "Document categories",
  // Expenses
  list_expenses: "List expenses",
  get_expense: "Get expense",
  create_expense: "Create expense",
  get_expense_summary: "Expense summary",
  list_expense_categories: "Expense categories",
  list_recurring_expenses: "Recurring expenses",
};

/** Deterministic color from a palette based on string hash. */
const TOOL_NAME_COLORS = [
  "text-blue-400",
  "text-emerald-400",
  "text-amber-400",
  "text-purple-400",
  "text-rose-400",
  "text-cyan-400",
  "text-orange-400",
] as const;

/** Human-readable labels for known MCP server names. */
const MCP_SERVER_LABELS: Record<string, string> = {
  almirant: "Almirant",
  context7: "Context7",
  playwright: "Playwright",
  memory: "Memory",
  filesystem: "Filesystem",
  "sequential-thinking": "Thinking",
  DeepGraph_React_MCP: "DeepGraph",
  plugin_posthog_posthog: "PostHog",
  plugin_serena_serena: "Serena",
  plugin_sentry_sentry: "Sentry",
  claude_ai_Context7: "Context7",
  claude_ai_Gmail: "Gmail",
  claude_ai_Google_Calendar: "Calendar",
};

/** Legacy/direct MCP tool prefixes emitted by some coding agents. */
const DIRECT_MCP_SERVER_PREFIXES: Record<string, string> = {
  almirant: "almirant",
};

export interface McpToolParts {
  serverRaw: string;
  serverLabel: string;
  action: string;
  actionLabel: string;
}

/** Parse an MCP tool name like `mcp__almirant__get_ideation_context`
 *  into server/action parts. Returns null for non-MCP tools. */
export const parseMcpToolName = (toolName: string): McpToolParts | null => {
  let serverRaw: string | undefined;
  let action: string | undefined;

  if (toolName.startsWith("mcp__")) {
    // Split on double underscore: ["mcp", serverName, ...actionParts]
    const parts = toolName.split("__");
    if (parts.length < 3) return null;
    serverRaw = parts[1];
    action = parts.slice(2).join("__");
  } else {
    for (const [prefix, server] of Object.entries(DIRECT_MCP_SERVER_PREFIXES)) {
      const directPrefix = `${prefix}_`;
      if (toolName.startsWith(directPrefix)) {
        serverRaw = server;
        action = toolName.slice(directPrefix.length);
        break;
      }
    }
  }

  if (!serverRaw || !action) return null;

  const serverLabel =
    MCP_SERVER_LABELS[serverRaw] ??
    serverRaw
      .replace(/^plugin_/, "")
      .split(/[_-]/)
      .pop()!
      .replace(/\b\w/g, (c) => c.toUpperCase());
  const actionLabel =
    MCP_ACTION_LABELS[action] ??
    action
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return { serverRaw, serverLabel, action, actionLabel };
};

/** Deterministic color from palette based on MCP server name. */
export const getToolServerColor = (serverRaw: string): string => {
  let hash = 0;
  for (let i = 0; i < serverRaw.length; i++) {
    hash = (hash * 31 + serverRaw.charCodeAt(i)) | 0;
  }
  return TOOL_NAME_COLORS[Math.abs(hash) % TOOL_NAME_COLORS.length];
};

export const humanizeToolName = (toolName: string): string => {
  // Known tool name overrides
  if (TOOL_NAME_MAP[toolName]) return TOOL_NAME_MAP[toolName];

  // MCP tools: mcp__almirant__get_ideation_context or
  // legacy/direct almirant_get_ideation_context → "Ideation context"
  const mcpParts = parseMcpToolName(toolName);
  if (mcpParts) return mcpParts.actionLabel;

  // Built-in tools: keep as-is (Read, Edit, Bash, etc.)
  return toolName;
};

/** Extract meaningful preview from a parsed JSON object. */
const extractPreviewFromObject = (
  parsed: Record<string, unknown>,
): string | undefined => {
  // Agent/Task tools: show description
  if (typeof parsed.description === "string") return parsed.description;
  // Query tools (ToolSearch, search, etc.)
  if (typeof parsed.query === "string") return parsed.query;
  // Task management: prioritize taskId and workItemIds over generic id
  if (typeof parsed.taskId === "string") return parsed.taskId;
  if (Array.isArray(parsed.workItemIds)) {
    const count = parsed.workItemIds.length;
    const col =
      typeof parsed.columnName === "string" ? parsed.columnName : undefined;
    return col ? `${count} items -> ${col}` : `${count} items`;
  }
  // MCP tools: show id, title, or name
  if (typeof parsed.id === "string") return `id: ${parsed.id}`;
  if (typeof parsed.title === "string") return `title: ${parsed.title}`;
  if (typeof parsed.name === "string") return `name: ${parsed.name}`;
  // File tools
  if (typeof parsed.file_path === "string") return parsed.file_path;
  if (typeof parsed.command === "string") return parsed.command;
  if (typeof parsed.pattern === "string") return parsed.pattern;
  return undefined;
};

const extractSkillName = (raw: string): string | undefined => {
  const pathMatch = raw.match(/(?:^|\/)skills\/([a-z0-9_-]+)\/SKILL\.md/i)?.[1];
  if (pathMatch) return pathMatch;

  const argsMatch = raw.match(/"args"\s*:\s*"\/?([a-z0-9_-]+)"/i)?.[1];
  if (argsMatch) return argsMatch;

  const directMatch = raw.match(/skill[":\s]+([a-z0-9_-]+)/i)?.[1];
  if (directMatch) return directMatch;

  const rawSlug = raw.trim();
  if (/^[a-z0-9][a-z0-9_-]*$/i.test(rawSlug)) return rawSlug;

  return undefined;
};

const formatSkillName = (skillName: string): string =>
  skillName.charAt(0).toUpperCase() + skillName.slice(1).replace(/[-_]/g, " ");

/** Clean up raw JSON input preview to something readable. */
export const humanizeInputPreview = (
  toolName: string,
  raw?: string,
): string | undefined => {
  if (!raw) return undefined;

  // --- Tool-specific formatting ---

  // ToolSearch: "query: select:mcp__almirant__get_ideation_context" → "Get Ideation Context"
  if (toolName === "ToolSearch") {
    // Extract the MCP tool name or query
    const selectMatch = raw.match(/select:mcp__[^_]+__(.+)/);
    if (selectMatch) {
      return selectMatch[1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
    const queryMatch = raw.match(/query:\s*(.+)/);
    if (queryMatch) return queryMatch[1].trim();
    // JSON format
    const jsonMatch = raw.match(/"query"\s*:\s*"([^"]*)/);
    if (jsonMatch) {
      const q = jsonMatch[1];
      const mcpSelect = q.match(/select:mcp__[^_]+__(.+)/);
      if (mcpSelect) return mcpSelect[1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return q;
    }
    return undefined;
  }

  // Skill: "skill: ideate" → "Ideate"
  if (toolName.toLowerCase() === "skill") {
    const skillName = extractSkillName(raw);
    if (skillName) return formatSkillName(skillName);
    return undefined;
  }

  // AskUserQuestion: don't show IDs, just hide detail
  if (toolName === "AskUserQuestion") return undefined;

  // TodoWrite: show task count
  if (toolName === "TodoWrite") {
    // Try JSON extraction - count task items in the tasks array
    const tasksMatch = raw.match(/"tasks"\s*:\s*\[/);
    if (tasksMatch) {
      // Count array items roughly by counting "id" fields
      const itemCount = (raw.match(/"id"\s*:/g) || []).length;
      if (itemCount > 0)
        return `${itemCount} task${itemCount > 1 ? "s" : ""}`;
    }
    return undefined;
  }

  // TaskUpdate: show what's being updated
  if (toolName === "TaskUpdate") {
    const taskIdMatch = raw.match(/"task_id"\s*:\s*"([^"]*)/);
    if (taskIdMatch?.[1]) return taskIdMatch[1];
    return undefined;
  }

  // MCP move_work_item: show taskId (human-readable, not UUID)
  if (toolName.includes("move_work_item") && !toolName.includes("batch")) {
    const taskIdMatch = raw.match(/"taskId"\s*:\s*"([^"]*)/);
    if (taskIdMatch?.[1] && !taskIdMatch[1].match(/^[0-9a-f]{8}-/))
      return taskIdMatch[1];
    return undefined;
  }

  // MCP batch_move_work_items: show count + column
  if (toolName.includes("batch_move_work_items")) {
    const idsCount = (raw.match(/"[0-9a-f]{8}-[0-9a-f]{4}-/g) || []).length;
    const colMatch = raw.match(/"columnName"\s*:\s*"([^"]*)/);
    if (idsCount > 0) {
      const col = colMatch?.[1];
      return col ? `${idsCount} items -> ${col}` : `${idsCount} items`;
    }
    return undefined;
  }

  // MCP tools: extract the meaningful action, not IDs
  if (toolName.startsWith("mcp__")) {
    // Already humanized by humanizeToolName, hide raw input unless it has useful fields
    if (raw.startsWith("id:") || raw.startsWith("id ")) return undefined;
  }

  // If it starts with JSON object, try to extract meaningful fields
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // Handle full tool_use JSON envelope first:
      // { "name": "ToolSearch", "id": "toolu_xxx", "input": { "query": "..." } }
      if (
        parsed.input &&
        typeof parsed.input === "object" &&
        (typeof parsed.name === "string" || parsed.type === "tool_use")
      ) {
        const inputObj = parsed.input as Record<string, unknown>;
        // Skip empty input (from content_block_start with input: {})
        if (Object.keys(inputObj).length > 0) {
          const fromInput = extractPreviewFromObject(inputObj);
          if (fromInput) {
            // Don't show just IDs for MCP tools
            if (fromInput.startsWith("id:") || fromInput.startsWith("id ")) return undefined;
            return fromInput;
          }
        }
      }

      // Try top-level fields directly (skip meta fields like name, id, type)
      const fromTop = extractPreviewFromObject(parsed);
      if (fromTop) {
        if (fromTop.startsWith("id:") || fromTop.startsWith("id ")) return undefined;
        return fromTop;
      }
    } catch {
      // Truncated JSON — try regex extraction (tolerates missing closing quote)
      const fields = ["file_path", "pattern", "command", "query", "description", "skill", "url"];
      for (const field of fields) {
        const match = raw.match(new RegExp(`"${field}"\\s*:\\s*"([^"]*)`));
        if (match?.[1]) return match[1];
      }
    }
  }

  // "key: value" format — strip the key prefix, return just the value
  if (/^[a-z_]+: /i.test(raw)) {
    if (raw.startsWith("id:") || raw.startsWith("id ")) return undefined;
    const skillMatch = raw.match(/^skill:\s*(.+)/i);
    if (skillMatch) return formatSkillName(skillMatch[1].trim());
    // Strip "file_path: ", "pattern: ", "command: ", etc.
    const colonIdx = raw.indexOf(": ");
    return colonIdx > 0 ? raw.slice(colonIdx + 2) : raw;
  }

  // Truncate long raw strings
  return raw.length > 100 ? `${raw.slice(0, 97)}...` : raw;
};

export const getToolNameColor = (key: string): string => {
  const normalizedKey = key === "skill" ? "Skill" : key;
  let hash = 0;
  for (let i = 0; i < normalizedKey.length; i++) {
    hash = (hash * 31 + normalizedKey.charCodeAt(i)) | 0;
  }
  return TOOL_NAME_COLORS[Math.abs(hash) % TOOL_NAME_COLORS.length];
};

interface ToolIconProps {
  toolName: string;
  className?: string;
}

export const ToolIcon: React.FC<ToolIconProps> = ({
  toolName,
  className = "size-4",
}) => {
  const knownIcon = TOOL_ICONS[toolName];
  if (knownIcon) {
    const KnownIcon = knownIcon;
    return <KnownIcon className={className} />;
  }

  if (
    toolName.startsWith("mcp__") ||
    toolName.includes("almirant") ||
    toolName.includes("context7") ||
    toolName.includes("playwright") ||
    toolName.includes("serena") ||
    toolName.includes("memory") ||
    toolName.includes("filesystem") ||
    toolName.includes("DeepGraph")
  ) {
    return <McpIcon className={className} />;
  }

  return <Wrench className={className} />;
};
