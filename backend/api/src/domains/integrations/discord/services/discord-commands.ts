export type DiscordCommandOptionType = 3;

export type DiscordApplicationCommandOption = {
  type: DiscordCommandOptionType;
  name: string;
  description: string;
  required?: boolean;
};

export type DiscordApplicationCommand = {
  type: 1;
  name: string;
  description: string;
  options?: DiscordApplicationCommandOption[];
};

export const DISCORD_SLASH_COMMANDS: DiscordApplicationCommand[] = [
  {
    type: 1,
    name: "implement",
    description: "Launch implementation for a work item",
    options: [
      {
        type: 3,
        name: "work_item_id",
        description: "Work item task id (for example A-582)",
        required: true,
      },
      {
        type: 3,
        name: "provider",
        description: "AI provider: codex (default), claude-code, or zipu",
        required: false,
      },
    ],
  },
  {
    type: 1,
    name: "plan",
    description: "Launch planning for a work item",
    options: [
      {
        type: 3,
        name: "work_item_id",
        description: "Work item task id (for example A-582)",
        required: true,
      },
      {
        type: 3,
        name: "provider",
        description: "AI provider: codex (default), claude-code, or zipu",
        required: false,
      },
    ],
  },
  {
    type: 1,
    name: "status",
    description: "Check a specific job or list active jobs",
    options: [
      {
        type: 3,
        name: "job_id",
        description: "Optional agent job id",
        required: false,
      },
    ],
  },
];

export const getDiscordSlashCommands = (): DiscordApplicationCommand[] => {
  return DISCORD_SLASH_COMMANDS;
};

export const getCommandOptionValue = (
  options: Array<{ name?: string; value?: unknown }> | undefined,
  optionName: string
): string | null => {
  if (!options || options.length === 0) {
    return null;
  }

  const found = options.find((option) => option.name === optionName);
  if (!found || typeof found.value !== "string") {
    return null;
  }

  const normalized = found.value.trim();
  return normalized.length > 0 ? normalized : null;
};
