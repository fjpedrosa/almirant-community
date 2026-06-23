// ---------------------------------------------------------------------------
// Tool Humanizer — human-friendly names, previews and emojis for Discord
// Ported from frontend/src/domains/ai-planning/presentation/components/tool-icon.tsx
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Emoji mapping
// ---------------------------------------------------------------------------

const TOOL_EMOJI: Record<string, string> = {
  Read: "\u{1F441}",      // 👁
  Write: "\u{1F4DD}",     // 📝
  Edit: "\u{270F}\u{FE0F}", // ✏️
  Bash: "\u{1F4BB}",      // 💻
  Grep: "\u{1F50D}",      // 🔍
  Glob: "\u{1F4C2}",      // 📂
  Agent: "\u{1F916}",     // 🤖
  Task: "\u{1F916}",      // 🤖
  Skill: "\u{1F3AF}",     // 🎯
  WebSearch: "\u{1F310}", // 🌐
  WebFetch: "\u{1F310}",  // 🌐
  ToolSearch: "\u{1F50D}", // 🔍
  NotebookEdit: "\u{1F4D3}", // 📓
};

const getMcpEmoji = (toolName: string): string => {
  if (toolName.includes("almirant")) return "\u{2728}";   // ✨
  if (toolName.includes("context7")) return "\u{1F4D6}";  // 📖
  if (toolName.includes("playwright")) return "\u{1F310}"; // 🌐
  if (toolName.includes("serena")) return "\u{1F4BB}";    // 💻
  if (toolName.includes("memory")) return "\u{1F9E0}";    // 🧠
  if (toolName.includes("filesystem")) return "\u{1F4C2}"; // 📂
  if (toolName.includes("DeepGraph")) return "\u{1F3D7}\u{FE0F}"; // 🏗️
  return "\u{1F527}"; // 🔧
};

export const getToolEmoji = (toolName: string): string =>
  TOOL_EMOJI[toolName] ?? getMcpEmoji(toolName);

// ---------------------------------------------------------------------------
// Human-friendly tool names
// ---------------------------------------------------------------------------

const TOOL_NAME_MAP: Record<string, string> = {
  ToolSearch: "Search",
  WebSearch: "Web Search",
  WebFetch: "Fetch",
  NotebookEdit: "Notebook",
  AskUserQuestion: "Question",
};

const MCP_ACTION_LABELS: Record<string, string> = {
  get_ideation_context: "Ideation Context",
  get_board_context: "Board Context",
  get_implement_context: "Implement Context",
  get_validate_context: "Validate Context",
  get_review_context: "Review Context",
  get_document_context: "Document Context",
  get_record_video_context: "Video Context",
  get_seeds_for_ideation: "Seeds for Ideation",
  list_work_items: "List Work Items",
  get_work_item: "Get Work Item",
  create_work_item: "Create Work Item",
  update_work_item: "Update Work Item",
  move_work_item: "Move Work Item",
  delete_work_item: "Delete Work Item",
  get_board: "Get Board",
  list_boards: "List Boards",
  get_project: "Get Project",
  list_projects: "List Projects",
  create_seed: "Create Seed",
  get_seed: "Get Seed",
  list_seeds: "List Seeds",
  promote_seed: "Promote Seed",
  create_idea_item: "Create Idea",
  list_idea_items: "List Ideas",
  get_active_sprint: "Active Sprint",
  get_sprint_work_items: "Sprint Items",
  create_milestone: "Create Milestone",
  get_milestone_progress: "Milestone Progress",
  generate_work_item_prompt: "Generate Prompt",
  get_work_item_prompt: "Get Prompt",
  check_quota: "Check Quota",
  link_commit_to_work_item: "Link Commit",
  complete_ai_task: "Complete Task",
  set_implementation_outcomes: "Set Outcomes",
  complete_review: "Complete Review",
  complete_validation: "Complete Validation",
  complete_validation_fail: "Validation Failed",
  complete_documentation: "Complete Documentation",
  record_ai_session: "Record Session",
  add_work_item_comment: "Add Comment",
  get_work_item_events: "Get Events",
  get_work_item_dependencies: "Get Dependencies",
  add_work_item_dependency: "Add Dependency",
  remove_work_item_dependency: "Remove Dependency",
  batch_move_work_items: "Batch Move Items",
  resolve_work_items: "Resolve Items",
  list_tags: "List Tags",
  create_tag: "Create Tag",
  list_members: "List Members",
  get_current_user: "Current User",
  list_milestones: "List Milestones",
  list_sprints: "List Sprints",
  create_sprint: "Create Sprint",
  close_sprint: "Close Sprint",
  get_quota_usage: "Quota Usage",
};

export const humanizeToolName = (toolName: string): string => {
  if (TOOL_NAME_MAP[toolName]) return TOOL_NAME_MAP[toolName];

  // MCP tools: mcp__almirant__link_commit_to_work_item → "Link Commit"
  const mcpMatch = toolName.match(/^mcp__([^_]+)__(.+)$/);
  if (mcpMatch) {
    const action = mcpMatch[2];
    if (MCP_ACTION_LABELS[action]) return MCP_ACTION_LABELS[action];
    return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Built-in tools: keep as-is
  return toolName;
};

// ---------------------------------------------------------------------------
// Human-friendly input previews
// ---------------------------------------------------------------------------

const extractPreviewFromObject = (
  parsed: Record<string, unknown>,
): string | undefined => {
  if (typeof parsed.description === "string") return parsed.description;
  if (typeof parsed.query === "string") return parsed.query;
  if (typeof parsed.title === "string") return parsed.title;
  if (typeof parsed.name === "string") return parsed.name;
  if (typeof parsed.file_path === "string") return parsed.file_path;
  if (typeof parsed.command === "string") return parsed.command;
  if (typeof parsed.pattern === "string") return parsed.pattern;
  // Skip raw IDs — not useful for display
  return undefined;
};

export const humanizeInputPreview = (
  toolName: string,
  raw?: string,
): string | undefined => {
  if (!raw) return undefined;

  // ToolSearch: extract query
  if (toolName === "ToolSearch") {
    const selectMatch = raw.match(/select:mcp__[^_]+__(.+)/);
    if (selectMatch) {
      return selectMatch[1].replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
    const queryMatch = raw.match(/query:\s*(.+)/);
    if (queryMatch) return queryMatch[1].trim();
    const jsonMatch = raw.match(/"query"\s*:\s*"([^"]*)/);
    if (jsonMatch) return jsonMatch[1];
    return undefined;
  }

  // Skill: extract skill name
  if (toolName === "Skill") {
    const skillName = raw.match(/skill[":.\s]+([a-z_-]+)/i)?.[1];
    if (skillName) return skillName.charAt(0).toUpperCase() + skillName.slice(1).replace(/[-_]/g, " ");
    return undefined;
  }

  // AskUserQuestion: hide detail
  if (toolName === "AskUserQuestion") return undefined;

  // MCP tools: don't show raw IDs
  if (toolName.startsWith("mcp__")) {
    if (raw.startsWith("id:") || raw.startsWith("id ")) return undefined;
  }

  // JSON object — extract meaningful fields
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // Handle tool_use envelope: { name, id, input: { ... } }
      if (
        parsed.input &&
        typeof parsed.input === "object" &&
        (typeof parsed.name === "string" || parsed.type === "tool_use")
      ) {
        const inputObj = parsed.input as Record<string, unknown>;
        if (Object.keys(inputObj).length > 0) {
          const fromInput = extractPreviewFromObject(inputObj);
          if (fromInput && !fromInput.startsWith("id:")) return fromInput;
        }
      }

      const fromTop = extractPreviewFromObject(parsed);
      if (fromTop && !fromTop.startsWith("id:")) return fromTop;
    } catch {
      // Truncated JSON — regex fallback
      const fields = ["file_path", "pattern", "command", "query", "description", "skill", "url"];
      for (const field of fields) {
        const match = raw.match(new RegExp(`"${field}"\\s*:\\s*"([^"]*)`));
        if (match?.[1]) return match[1];
      }
    }
  }

  // "key: value" format
  if (/^[a-z_]+: /i.test(raw)) {
    if (raw.startsWith("id:") || raw.startsWith("id ")) return undefined;
    const colonIdx = raw.indexOf(": ");
    return colonIdx > 0 ? raw.slice(colonIdx + 2) : raw;
  }

  // Truncate long raw strings
  return raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
};

// ---------------------------------------------------------------------------
// Subagent type formatting
// ---------------------------------------------------------------------------

export const formatAgentType = (raw?: string): string => {
  if (!raw) return "Agent";
  return raw
    .split(/[-_:]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};
