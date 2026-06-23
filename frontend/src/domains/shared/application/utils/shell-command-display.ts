export type ShellCommandDisplayAlias = {
  toolName:
    | "Git"
    | "GitHub"
    | "Install"
    | "Test"
    | "Lint"
    | "TypeCheck"
    | "Env"
    | "Date"
    | "Read"
    | "Glob"
    | "Grep"
    | "Edit"
    | `mcp__${string}__${string}`;
  inputPreview: string;
  cleanCommand: string;
};

const stripMatchingQuotes = (value: string): string => {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "'" && last === "'") || (first === "\"" && last === "\"")) {
    return value.slice(1, -1);
  }
  return value;
};

const normalizeShellCommandInput = (command: string): string => {
  const trimmed = command.trim();
  return trimmed.startsWith("command: ")
    ? trimmed.slice("command: ".length).trim()
    : trimmed;
};

export const unwrapShellCommand = (command: string): string => {
  const normalized = normalizeShellCommandInput(command);
  const shellWrapperMatch = normalized.match(
    /^(?:(?:\/usr\/bin\/env\s+)?(?:\/bin\/)?(?:bash|sh|zsh))\s+-lc\s+([\s\S]+)$/i,
  );
  if (!shellWrapperMatch?.[1]) return normalized;
  return stripMatchingQuotes(shellWrapperMatch[1].trim());
};

const stripLeadingShellQuotes = (command: string): string =>
  command.trimStart().replace(/^(?:\$?['"`])+/u, "");

const tokenizeShellLike = (command: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
};

const getPathLikeTokens = (tokens: string[]): string[] =>
  tokens.filter((token) =>
    Boolean(token) &&
    !token.startsWith("-") &&
    !/^\d?>/.test(token) &&
    /[/.]/.test(token) &&
    !/^(?:\.\/)?node_modules\/\.bin\/(?:eslint|tsc)$/i.test(token) &&
    !/^(?:bun|bunx|run|test|install|eslint|lint|type-?check)$/i.test(token),
  );

const getPrimaryShellSegment = (command: string): string => {
  const [primary] = command.split(/\s*(?:\|\||&&|;|\|)\s*/);
  return primary?.trim() ?? command.trim();
};

const getCommandTargetPreview = (
  cleanCommand: string,
  fallback: string,
): string => {
  const tokens = tokenizeShellLike(cleanCommand);
  const pathTokens = getPathLikeTokens(tokens);
  if (pathTokens.length === 1) return pathTokens[0];
  if (pathTokens.length > 1) return `${pathTokens.length} files`;
  return fallback;
};

const getLastPositionalToken = (tokens: string[]): string | undefined => {
  for (let index = tokens.length - 1; index >= 1; index -= 1) {
    const token = tokens[index];
    if (!token || token.startsWith("-")) continue;
    return token;
  }
  return undefined;
};

const getFirstQuotedValue = (command: string): string | undefined => {
  const normalized = command
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'");
  const match = normalized.match(/(["'])(.*?)\1/);
  return match?.[2]?.trim() || undefined;
};

const titleCase = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const normalizeMcpServerName = (value: string): string =>
  value.replace(/^mcp__/, "").trim();

const extractMcpServerFromShellCommand = (
  cleanCommand: string,
): string | null => {
  const configServerMatch = cleanCommand.match(
    /\.mcpServers\.([A-Za-z0-9_-]+)\.(?:url|headers)\b/,
  );
  if (configServerMatch?.[1]) {
    return normalizeMcpServerName(configServerMatch[1]);
  }

  const explicitToolMatch = cleanCommand.match(/\bmcp__([A-Za-z0-9_-]+)__[A-Za-z0-9_-]+\b/);
  if (explicitToolMatch?.[1]) {
    return normalizeMcpServerName(explicitToolMatch[1]);
  }

  if (/\bbackend:3001\/mcp\b|\blocalhost:3001\/mcp\b|\b\/mcp\?/.test(cleanCommand)) {
    return "almirant";
  }

  return null;
};

const extractMcpToolActionFromShellCommand = (
  normalizedCommand: string,
): { action: string; inputPreview: string } | null => {
  const toolCallMatch = normalizedCommand.match(
    /"method"\s*:\s*"tools\/call"[\s\S]*?"params"\s*:\s*\{[\s\S]*?"name"\s*:\s*"([^"]+)"/,
  );
  if (toolCallMatch?.[1]) {
    return {
      action: toolCallMatch[1],
      inputPreview: buildMcpShellInputPreview(
        toolCallMatch[1],
        normalizedCommand,
      ),
    };
  }

  const schemaMatch = normalizedCommand.match(
    /"method"\s*:\s*"tools\/list"[\s\S]*?select\(\s*\.name\s*==\s*"([^"]+)"\s*\)[\s\S]*?\.inputSchema\b/,
  );
  if (schemaMatch?.[1]) {
    return {
      action: schemaMatch[1],
      inputPreview: "Schema",
    };
  }

  if (/"method"\s*:\s*"tools\/list"/.test(normalizedCommand)) {
    return {
      action: "list_tools",
      inputPreview: "List tools",
    };
  }

  return null;
};

const countUuidStrings = (value: string): number =>
  (value.match(/"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/gi) ?? []).length;

const buildMcpShellInputPreview = (
  action: string,
  normalizedCommand: string,
): string => {
  const workItemIdsMatch = normalizedCommand.match(
    /"workItemIds"\s*:\s*(?:\$[A-Z_]+|\[([\s\S]*?)\])/,
  );
  if (workItemIdsMatch) {
    const arrayBody = workItemIdsMatch[1];
    const count = arrayBody ? countUuidStrings(arrayBody) : countUuidStrings(normalizedCommand.match(/[A-Z_]+=\[([\s\S]*?)\]/)?.[1] ?? "");
    if (count > 0) {
      const columnNameMatch = normalizedCommand.match(/"columnName"\s*:\s*"([^"]+)"/);
      return columnNameMatch?.[1]
        ? `${count} items -> ${columnNameMatch[1]}`
        : `${count} items`;
    }
  }

  const taskIdMatch = normalizedCommand.match(/"taskId"\s*:\s*"([^"]+)"/);
  if (taskIdMatch?.[1]) return `taskId: ${taskIdMatch[1]}`;

  const titleMatch = normalizedCommand.match(/"title"\s*:\s*"([^"]+)"/);
  if (titleMatch?.[1]) return titleMatch[1];

  return titleCase(action);
};

const getMcpShellAlias = (
  cleanCommand: string,
): ShellCommandDisplayAlias | null => {
  if (!/\btools\/(?:call|list)\b/.test(cleanCommand) || !/\bcurl\b/.test(cleanCommand)) {
    return null;
  }

  const server = extractMcpServerFromShellCommand(cleanCommand);
  if (!server) return null;

  const normalizedCommand = cleanCommand.replace(/\\"/g, "\"");
  const action = extractMcpToolActionFromShellCommand(normalizedCommand);
  if (!action) return null;

  return {
    toolName: `mcp__${server}__${action.action}`,
    inputPreview: action.inputPreview,
    cleanCommand,
  };
};

const gitCommandPattern = /(?:^|[;&|]\s*)git(?:\s+-C\s+\S+)?\s+/i;

const getGitPreview = (cleanCommand: string): string => {
  if (/\bgit(?:\s+-C\s+\S+)?\s+status\b/i.test(cleanCommand)) return "Status";
  if (/\bgit(?:\s+-C\s+\S+)?\s+diff\b/i.test(cleanCommand)) {
    if (/--name-only\b/i.test(cleanCommand)) return "Changed files";
    if (/--stat\b/i.test(cleanCommand)) return "Diff stat";
    return "Diff";
  }
  if (/\bgit(?:\s+-C\s+\S+)?\s+branch\b/i.test(cleanCommand) && /\bgit(?:\s+-C\s+\S+)?\s+remote\b/i.test(cleanCommand)) {
    return "Branch & remotes";
  }
  if (/\bgit(?:\s+-C\s+\S+)?\s+branch\b/i.test(cleanCommand)) return "Branch";
  if (/\bgit(?:\s+-C\s+\S+)?\s+remote\b/i.test(cleanCommand)) {
    if (/\bget-url\b/i.test(cleanCommand)) return "Remote URL";
    return "Remotes";
  }
  if (/\bgit(?:\s+-C\s+\S+)?\s+rev-parse\b/i.test(cleanCommand)) {
    const refMatch = cleanCommand.match(/\brev-parse\b\s+([^\s;&|]+)/i);
    return refMatch?.[1] ? `Resolve ${refMatch[1]}` : "Resolve revision";
  }
  if (/\bgit(?:\s+-C\s+\S+)?\s+push\b/i.test(cleanCommand)) {
    const branchMatch = cleanCommand.match(/\bpush\b(?:\s+-\S+)*\s+\S+\s+([^\s;&|]+)/i);
    return branchMatch?.[1] ? `Push ${branchMatch[1]}` : "Push";
  }
  if (/\bgit(?:\s+-C\s+\S+)?\s+fetch\b/i.test(cleanCommand) && /\bgit(?:\s+-C\s+\S+)?\s+worktree\b/i.test(cleanCommand)) {
    return "Fetch & worktree";
  }
  if (/\bgit(?:\s+-C\s+\S+)?\s+worktree\b/i.test(cleanCommand)) return "Worktree";
  if (/\bgit(?:\s+-C\s+\S+)?\s+add\b/i.test(cleanCommand) && /\bgit(?:\s+-C\s+\S+)?\s+commit\b/i.test(cleanCommand)) {
    return "Commit";
  }
  if (/\bgit(?:\s+-C\s+\S+)?\s+commit\b/i.test(cleanCommand)) return "Commit";
  if (/\bgit(?:\s+-C\s+\S+)?\s+add\b/i.test(cleanCommand)) return "Stage";
  if (/\bgit(?:\s+-C\s+\S+)?\s+fetch\b/i.test(cleanCommand)) return "Fetch";
  return "Command";
};

const getGitHubPreview = (cleanCommand: string): string => {
  if (/^\s*gh\s+pr\s+create\b/i.test(cleanCommand)) return "Create PR";
  if (/^\s*gh\s+pr\s+view\b/i.test(cleanCommand)) return "View PR";
  if (/^\s*gh\s+pr\s+list\b/i.test(cleanCommand)) return "List PRs";

  const match = cleanCommand.match(/^\s*gh\s+([a-z-]+)(?:\s+([a-z-]+))?/i);
  if (!match?.[1]) return "CLI";

  const resource = match[1].toLowerCase() === "pr"
    ? "PR"
    : titleCase(match[1]);
  const action = match[2] ? titleCase(match[2]) : "";

  return action ? `${action} ${resource}` : resource;
};

const getEnvPreview = (cleanCommand: string): string => {
  if (/\bALMIRANT_[A-Z0-9_]+\b/.test(cleanCommand)) return "Almirant variables";
  if (/\bGH\b|\bGITHUB\b/i.test(cleanCommand)) return "GitHub variables";
  return "Environment";
};

const getDatePreview = (cleanCommand: string): string =>
  /\s-u\b|^date\s+-u\b/i.test(cleanCommand) ? "UTC time" : "Current time";

const getReadPreview = (cleanCommand: string): string => {
  const tokens = tokenizeShellLike(getPrimaryShellSegment(cleanCommand));
  const pathTokens = getPathLikeTokens(tokens);
  return pathTokens.at(-1) ?? getLastPositionalToken(tokens) ?? "Inspect path";
};

const getGlobPreview = (cleanCommand: string): string => {
  const primarySegment = getPrimaryShellSegment(cleanCommand);
  const tokens = tokenizeShellLike(primarySegment);
  const commandName = tokens[0];

  if (commandName === "find") {
    return tokens[1] ?? "Search files";
  }

  if (commandName === "rg" && tokens.includes("--files")) {
    const filesFlagIndex = tokens.indexOf("--files");
    return tokens
      .slice(filesFlagIndex + 1)
      .find((token) => token && !token.startsWith("-")) ?? "Search files";
  }

  return getLastPositionalToken(tokens) ?? "Search files";
};

const getGrepPreview = (cleanCommand: string): string => {
  const primarySegment = getPrimaryShellSegment(cleanCommand);
  const quoted = getFirstQuotedValue(primarySegment);
  if (quoted) return quoted;

  const tokens = tokenizeShellLike(primarySegment);
  const firstSearchTokenIndex = tokens[0] === "git" ? 2 : 1;
  return tokens
    .slice(firstSearchTokenIndex)
    .find((token) => token && !token.startsWith("-")) ?? "Search content";
};

const getEditPreview = (cleanCommand: string): string => {
  const tokens = tokenizeShellLike(getPrimaryShellSegment(cleanCommand));
  return getLastPositionalToken(tokens) ?? "Edit file";
};

const getShellPathCheckAlias = (
  cleanCommand: string,
): ShellCommandDisplayAlias | null => {
  const tokens = tokenizeShellLike(getPrimaryShellSegment(cleanCommand));
  if (tokens[0] !== "test") return null;
  if (!["-d", "-e", "-f"].includes(tokens[1] ?? "")) return null;

  const target = tokens[2];
  if (!target) return null;

  return {
    toolName: "Read",
    inputPreview: target,
    cleanCommand,
  };
};

const getLintPreview = (cleanCommand: string): string =>
  getCommandTargetPreview(getPrimaryShellSegment(cleanCommand), "Project");

const getBunLikeAlias = (
  cleanCommand: string,
): ShellCommandDisplayAlias | null => {
  if (/^\s*bun(?:x)?\s+install\b/i.test(cleanCommand)) {
    return {
      toolName: "Install",
      inputPreview: "Dependencies",
      cleanCommand,
    };
  }

  if (
    /^\s*bun\s+run\s+type-?check\b/i.test(cleanCommand) ||
    /\btsc\b[\s\S]*--noEmit\b/i.test(cleanCommand)
  ) {
    return {
      toolName: "TypeCheck",
      inputPreview: getCommandTargetPreview(cleanCommand, "Project"),
      cleanCommand,
    };
  }

  if (
    /^\s*bun\s+run\s+lint\b/i.test(cleanCommand) ||
    /^\s*bunx\s+eslint\b/i.test(cleanCommand) ||
    /^\s*(?:\.\/)?node_modules\/\.bin\/eslint\b/i.test(cleanCommand) ||
    /^\s*eslint\b/i.test(cleanCommand)
  ) {
    return {
      toolName: "Lint",
      inputPreview: getLintPreview(cleanCommand),
      cleanCommand,
    };
  }

  if (
    /^\s*bun\s+test\b/i.test(cleanCommand) ||
    /^\s*bun\s+x\s+tsx\b[\s\S]*\s--test\b/i.test(cleanCommand) ||
    /^\s*bunx\s+tsx\b[\s\S]*\s--test\b/i.test(cleanCommand) ||
    /^\s*(?:vitest|jest)\b/i.test(cleanCommand)
  ) {
    return {
      toolName: "Test",
      inputPreview: getCommandTargetPreview(cleanCommand, "Tests"),
      cleanCommand,
    };
  }

  return null;
};

export const classifyShellCommandForDisplay = (
  command: string,
): ShellCommandDisplayAlias | null => {
  const cleanCommand = stripLeadingShellQuotes(unwrapShellCommand(command));
  if (!cleanCommand) return null;

  const mcpAlias = getMcpShellAlias(cleanCommand);
  if (mcpAlias) return mcpAlias;

  if (/^\s*gh\b/i.test(cleanCommand)) {
    return {
      toolName: "GitHub",
      inputPreview: getGitHubPreview(cleanCommand),
      cleanCommand,
    };
  }

  if (/^\s*env\b/i.test(cleanCommand) && /\|\s*(?:grep|rg)\b/i.test(cleanCommand)) {
    return {
      toolName: "Env",
      inputPreview: getEnvPreview(cleanCommand),
      cleanCommand,
    };
  }

  if (/^\s*echo\b/i.test(cleanCommand) && /\$[A-Z_][A-Z0-9_]*\b/.test(cleanCommand)) {
    return {
      toolName: "Env",
      inputPreview: getEnvPreview(cleanCommand),
      cleanCommand,
    };
  }

  if (/^\s*date\b/i.test(cleanCommand)) {
    return {
      toolName: "Date",
      inputPreview: getDatePreview(cleanCommand),
      cleanCommand,
    };
  }

  if (/^\s*ls\b/i.test(cleanCommand)) {
    return {
      toolName: "Read",
      inputPreview: getReadPreview(cleanCommand),
      cleanCommand,
    };
  }

  if (/^\s*(?:cat|head|tail|less|more|nl)\b/i.test(cleanCommand)) {
    return {
      toolName: "Read",
      inputPreview: getReadPreview(cleanCommand),
      cleanCommand,
    };
  }

  const pathCheckAlias = getShellPathCheckAlias(cleanCommand);
  if (pathCheckAlias) return pathCheckAlias;

  if (/^\s*sed\b/i.test(cleanCommand)) {
    if (/\s-i(?:\s|[^A-Za-z0-9_-]|$)/i.test(cleanCommand)) {
      return {
        toolName: "Edit",
        inputPreview: getEditPreview(cleanCommand),
        cleanCommand,
      };
    }

    if (/\s-n(?:\s|$)/i.test(cleanCommand)) {
      return {
        toolName: "Read",
        inputPreview: getReadPreview(cleanCommand),
        cleanCommand,
      };
    }
  }

  if (/^\s*perl\b/i.test(cleanCommand) && /\s-pi\b/i.test(cleanCommand)) {
    return {
      toolName: "Edit",
      inputPreview: getEditPreview(cleanCommand),
      cleanCommand,
    };
  }

  if (/^\s*(?:find|fd)\b/i.test(cleanCommand)) {
    return {
      toolName: "Glob",
      inputPreview: getGlobPreview(cleanCommand),
      cleanCommand,
    };
  }

  if (/^\s*rg\b/i.test(cleanCommand)) {
    if (/\s--files(?:\s|$)/i.test(cleanCommand)) {
      return {
        toolName: "Glob",
        inputPreview: getGlobPreview(cleanCommand),
        cleanCommand,
      };
    }

    return {
      toolName: "Grep",
      inputPreview: getGrepPreview(cleanCommand),
      cleanCommand,
    };
  }

  if (/^\s*grep\b/i.test(cleanCommand) || /^\s*git\s+grep\b/i.test(cleanCommand)) {
    return {
      toolName: "Grep",
      inputPreview: getGrepPreview(cleanCommand),
      cleanCommand,
    };
  }

  const bunAlias = getBunLikeAlias(cleanCommand);
  if (bunAlias) return bunAlias;

  if (gitCommandPattern.test(cleanCommand)) {
    return {
      toolName: "Git",
      inputPreview: getGitPreview(cleanCommand),
      cleanCommand,
    };
  }

  return null;
};
