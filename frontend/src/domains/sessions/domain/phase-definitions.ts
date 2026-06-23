export interface PhaseDefinition {
  id: string;
  label: string;
}

export const PHASE_DEFINITIONS: Record<string, PhaseDefinition[]> = {
  implementation: [
    { id: "setup", label: "Setup" },
    { id: "analysis", label: "Analysis" },
    { id: "implementation", label: "Implementation" },
    { id: "testing", label: "Testing" },
    { id: "commit", label: "Commit" },
    { id: "push", label: "Push" },
  ],
  validation: [
    { id: "setup", label: "Setup" },
    { id: "review", label: "Review" },
    { id: "testing", label: "Testing" },
    { id: "diagnosis", label: "Diagnosis" },
  ],
  review: [
    { id: "setup", label: "Setup" },
    { id: "analysis", label: "Analysis" },
    { id: "review", label: "Review" },
    { id: "report", label: "Report" },
  ],
  planning: [
    { id: "setup", label: "Setup" },
    { id: "research", label: "Research" },
    { id: "brainstorming", label: "Brainstorming" },
    { id: "structuring", label: "Structuring" },
    { id: "creation", label: "Creation" },
  ],
  "bug-fix": [
    { id: "setup", label: "Setup" },
    { id: "diagnosis", label: "Diagnosis" },
    { id: "fix", label: "Fix" },
    { id: "testing", label: "Testing" },
    { id: "commit", label: "Commit" },
  ],
};

export const DEFAULT_PHASES: PhaseDefinition[] = [
  { id: "setup", label: "Setup" },
  { id: "processing", label: "Processing" },
  { id: "completion", label: "Completion" },
];

export const getPhasesForJobType = (jobType: string | undefined): PhaseDefinition[] => {
  if (!jobType) return DEFAULT_PHASES;
  return PHASE_DEFINITIONS[jobType] ?? DEFAULT_PHASES;
};
