import { z } from "zod";

const solutionChangeSchema = z.object({
  file: z.string(),
  description: z.string(),
  before: z.string().optional(),
  after: z.string().optional(),
});

export const proposedSolutionSchema = z.object({
  rootCause: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  changes: z.array(solutionChangeSchema),
});

export type ProposedSolutionChange = z.infer<typeof solutionChangeSchema>;
export type ProposedSolution = z.infer<typeof proposedSolutionSchema>;

/**
 * Defensively parse the `bugFixAttempts.solutionProposed` JSON string.
 *
 * Returns `null` for null/empty input, JSON-parse failures, and schema
 * validation failures — never throws. Extra fields in the payload are
 * ignored (`.strict()` is intentionally NOT applied so the schema can
 * evolve backward-compatibly).
 *
 * The canonical schema source of truth lives in
 * `.claude/skills/feedback-bug-analyze/SKILL.md`. If that contract evolves,
 * keep this Zod schema in sync.
 */
export const parseSolutionProposed = (
  raw: string | null | undefined,
): ProposedSolution | null => {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = proposedSolutionSchema.safeParse(parsed);
  return result.success ? result.data : null;
};
