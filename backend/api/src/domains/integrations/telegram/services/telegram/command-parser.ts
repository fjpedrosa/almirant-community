export type ParsedCommand = {
  command: string;
  args: string;
  parts: string[];
};

export function parseTelegramCommand(text: string): ParsedCommand | null {
  const raw = text.trim();
  if (!raw.startsWith("/")) return null;

  const [head, ...rest] = raw.split(/\s+/);
  if (!head) return null;

  // Support /cmd@botname form
  const cmd = head.split("@")[0] ?? head;
  const command = cmd.replace(/^\//, "").toLowerCase();
  const parts = rest;
  return {
    command,
    args: rest.join(" ").trim(),
    parts,
  };
}

