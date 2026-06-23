import type {
  DiscordActionRow,
  DiscordButtonComponent,
  DiscordContextSummary,
  DiscordEmbed,
  DiscordMessagePayload,
  DiscordQuestionPrompt,
  DiscordWaveTreeNode,
} from "./types";
import { DISCORD_LIMITS } from "./types";

const ANSI_REGEX = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const clamp = (value: string, max: number): string => {
  if (value.length <= max) {
    return value;
  }
  if (max <= 1) {
    return value.slice(0, max);
  }
  return `${value.slice(0, max - 1)}…`;
};

export const stripAnsiForDiscord = (text: string): string => {
  return text.replaceAll(ANSI_REGEX, "");
};

export const toDiscordCodeBlock = (
  content: string,
  language = "ansi"
): string => {
  const sanitized = stripAnsiForDiscord(content);
  return `\`\`\`${language}\n${sanitized}\n\`\`\``;
};

export const splitMessageContent = (
  content: string,
  maxChars = DISCORD_LIMITS.messageContent
): string[] => {
  if (content.length <= maxChars) {
    return [content];
  }

  const chunks: string[] = [];
  let offset = 0;

  while (offset < content.length) {
    const end = Math.min(offset + maxChars, content.length);
    const segment = content.slice(offset, end);
    chunks.push(segment);
    offset = end;
  }

  return chunks;
};

export const truncateToRelevantLines = (
  text: string,
  options: {
    maxChars?: number;
    maxLines?: number;
    preserveHeadLines?: number;
  } = {}
): string => {
  const maxChars = options.maxChars ?? 1900;
  const maxLines = options.maxLines ?? 60;
  const preserveHeadLines = options.preserveHeadLines ?? 6;

  const lines = stripAnsiForDiscord(text)
    .split(/\r?\n/)
    .filter((line) => line.length > 0 || linesHasMeaningfulNeighbors(text));

  const compactLines = lines.length > 0 ? lines : [stripAnsiForDiscord(text)];
  const trimmedByLines =
    compactLines.length <= maxLines
      ? compactLines
      : [
          ...compactLines.slice(0, preserveHeadLines),
          `... (${compactLines.length - maxLines} lines omitted) ...`,
          ...compactLines.slice(-(maxLines - preserveHeadLines - 1)),
        ];

  const joined = trimmedByLines.join("\n");
  if (joined.length <= maxChars) {
    return joined;
  }

  const overflow = joined.length - maxChars;
  const footer = `\n... (${overflow} chars omitted)`;
  return `${joined.slice(Math.max(0, maxChars - footer.length))}${footer}`;
};

const linesHasMeaningfulNeighbors = (text: string): boolean => {
  return /\n/.test(text);
};

const statusToColor = (status?: string): number => {
  if (!status) return 0x5865f2;
  const normalized = status.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("error")) return 0xed4245;
  if (normalized.includes("done") || normalized.includes("success") || normalized.includes("complete")) {
    return 0x57f287;
  }
  if (normalized.includes("wait") || normalized.includes("pending")) return 0xfee75c;
  return 0x5865f2;
};

const formatToken = (value?: number): string => {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return value.toLocaleString("en-US");
};

const formatCost = (value?: number): string => {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `$${value.toFixed(4)}`;
};

export const formatContextEmbed = (summary: DiscordContextSummary): DiscordEmbed => {
  const spinner = summary.spinner ? `${summary.spinner} ` : "";
  const status = summary.status ?? "running";

  const fields = [
    {
      name: "Branch",
      value: clamp(summary.branch ?? "n/a", DISCORD_LIMITS.embedFieldValue),
      inline: true,
    },
    {
      name: "Model",
      value: clamp(summary.model ?? "n/a", DISCORD_LIMITS.embedFieldValue),
      inline: true,
    },
    {
      name: "Status",
      value: clamp(`${spinner}${status}`, DISCORD_LIMITS.embedFieldValue),
      inline: true,
    },
    {
      name: "Tokens",
      value: clamp(
        `in: ${formatToken(summary.tokensIn)}\\nout: ${formatToken(summary.tokensOut)}`,
        DISCORD_LIMITS.embedFieldValue
      ),
      inline: true,
    },
    {
      name: "Estimated Cost",
      value: clamp(formatCost(summary.costUsd), DISCORD_LIMITS.embedFieldValue),
      inline: true,
    },
  ];

  return {
    title: clamp("Execution Context", DISCORD_LIMITS.embedTitle),
    color: statusToColor(status),
    fields: fields.slice(0, DISCORD_LIMITS.embedFieldCount),
    timestamp: new Date().toISOString(),
  };
};

const statusIcon = (status?: DiscordWaveTreeNode["status"]): string => {
  switch (status) {
    case "success":
      return "[ok]";
    case "failed":
      return "[x]";
    case "running":
      return "[~]";
    default:
      return "[ ]";
  }
};

export const formatWaveTree = (nodes: DiscordWaveTreeNode[]): string => {
  if (nodes.length === 0) {
    return "(no agents in wave)";
  }

  return nodes
    .map((node, index) => {
      const branchGlyph = index === nodes.length - 1 ? "└─" : "├─";
      return `${branchGlyph} ${statusIcon(node.status)} ${node.agent} | ${node.taskId} | ${node.title}`;
    })
    .join("\n");
};

export const formatQuestionPrompt = (
  prompt: DiscordQuestionPrompt
): DiscordMessagePayload => {
  const options = (prompt.options ?? []).filter((opt) => opt.trim().length > 0);
  const questionText = clamp(prompt.question, DISCORD_LIMITS.embedDescription);
  const optionLines =
    options.length > 0
      ? options.map((option, index) => `${index + 1}. ${option}`).join("\n")
      : "Respond with free text in this thread.";

  const description = [
    questionText,
    "",
    options.length > 0 ? "Options:" : "Response:",
    clamp(optionLines, DISCORD_LIMITS.embedDescription),
  ].join("\n");

  const components =
    prompt.jobId && options.length > 0
      ? buildQuestionComponents(prompt.jobId, options)
      : undefined;

  return {
    embeds: [
      {
        title: clamp("User input required", DISCORD_LIMITS.embedTitle),
        description: clamp(description, DISCORD_LIMITS.embedDescription),
        color: 0xfee75c,
        timestamp: new Date().toISOString(),
      },
    ],
    components,
  };
};

export type SessionControlState = "running" | "stopped" | "shutdown";

const controlIndicator = (
  jobId: string,
  label: string,
  style: DiscordButtonComponent["style"]
): DiscordButtonComponent => ({
  type: 2,
  style,
  label,
  custom_id: `indicator:${jobId}`,
  disabled: true,
});

const buildQuestionComponents = (
  jobId: string,
  options: string[]
): DiscordActionRow[] => {
  if (options.length === 2) {
    return [
      {
        type: 1,
        components: options.map(
          (option, index): DiscordButtonComponent => ({
            type: 2,
            style: index === 0 ? 1 : 2,
            label: clamp(option, 80),
            custom_id: `answer:${jobId}:${index}`,
          })
        ),
      },
    ];
  }

  return [
    {
      type: 1,
      components: [
        {
          type: 3,
          custom_id: `answer:${jobId}`,
          placeholder: "Choose an option",
          min_values: 1,
          max_values: 1,
          options: options.slice(0, 25).map((option, index) => ({
            label: clamp(option, 100),
            value: String(index),
            description: clamp(`Option ${index + 1}`, 100),
          })),
        },
      ],
    },
  ];
};

export const buildSessionControlComponents = (
  jobId: string,
  state: SessionControlState
): DiscordActionRow[] => {
  if (state === "shutdown" || state === "stopped") {
    return [];
  }

  return [
    {
      type: 1,
      components: [
        controlIndicator(jobId, "🟢 Running", 3),
        {
          type: 2,
          style: 4,
          label: "⏹ Stop",
          custom_id: `stop:${jobId}`,
        },
        {
          type: 2,
          style: 2,
          label: "🔌 Shutdown",
          custom_id: `shutdown:${jobId}`,
        },
      ],
    },
  ];
};

/**
 * Formats thinking content as a Discord blockquote.
 * The header "> 💭 **Thinking**" is followed by each line prefixed with `> `.
 *
 * @param rawContent - The raw thinking text (already sanitized by the caller).
 * @param maxChars  - Maximum total characters for the formatted message
 *                    (defaults to DISCORD_LIMITS.messageContent).
 * @returns The formatted string ready to send to Discord.
 */
export const formatThinkingBlock = (
  rawContent: string,
  maxChars = DISCORD_LIMITS.messageContent
): string => {
  const header = "> 💭 **Thinking**\n";
  const budget = maxChars - header.length;

  if (budget <= 0) {
    return header.trim();
  }

  const stripped = stripAnsiForDiscord(rawContent);
  const truncated = stripped.length > budget
    ? `${stripped.slice(0, budget - 1)}…`
    : stripped;

  const quoted = truncated
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");

  return `${header}${quoted}`;
};

export const formatWaveEmbed = (
  title: string,
  nodes: DiscordWaveTreeNode[]
): DiscordMessagePayload => {
  const tree = formatWaveTree(nodes);
  return {
    embeds: [
      {
        title: clamp(title, DISCORD_LIMITS.embedTitle),
        description: clamp(tree, DISCORD_LIMITS.embedDescription),
        color: 0x5865f2,
      },
    ],
  };
};
