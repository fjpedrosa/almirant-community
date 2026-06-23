// ---------------------------------------------------------------------------
// Job labels and thread naming — pure domain logic
//
// Maps job types to human-readable labels with emojis for Discord threads.
// No framework or infrastructure dependencies.
// ---------------------------------------------------------------------------

const JOB_TYPE_LABELS: Record<string, { emoji: string; label: string }> = {
  implementation: { emoji: "\u{1F527}", label: "Implementando" },
  validation: { emoji: "\u{1F527}", label: "Validando" },
  "nightly-fix": { emoji: "\u{1F527}", label: "Reparando" },
  review: { emoji: "\u{1F527}", label: "Revisando" },
  planning: { emoji: "\u{1F4CB}", label: "Planificando" },
  recording: { emoji: "\u{1F3AC}", label: "Grabando" },
};

const DEFAULT_LABEL = { emoji: "\u{1F527}", label: "Procesando" };

export const buildThreadName = (jobType: string, taskId: string): string => {
  const { emoji, label } = JOB_TYPE_LABELS[jobType] ?? DEFAULT_LABEL;
  return `${emoji} ${label} ${taskId}`;
};

/**
 * Strip any existing status prefix emoji before adding a new one.
 * Handles: ✅ ❌ ⏸️ 🔧 and other common prefixes.
 */
export const stripStatusPrefix = (name: string): string =>
  name.replace(/^[\u2705\u274C\u26A0\u23F8\uFE0F\uD83D\uDD27]\s*/, "");

export const buildTerminalThreadName = (
  originalName: string,
  status: "completed" | "incomplete" | "failed",
): string => {
  const prefix = status === "completed" ? "\u{2705}" : status === "incomplete" ? "\u26A0\uFE0F" : "\u{274C}";
  const baseName = stripStatusPrefix(originalName);
  return `${prefix} ${baseName}`;
};
