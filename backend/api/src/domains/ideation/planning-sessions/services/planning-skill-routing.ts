const WORK_ITEM_ID_REGEX = /\b([A-Z]{1,4}(?:-[ETFSK])?-\d+)\b/;
const REFINEMENT_KEYWORD_REGEX =
  /\b(epic|epica|feature|story|historia|refina|refinar|refine|alcance|scope|dependenc(?:y|ies)|dependencia|dependencias|implementaci(?:o|ó)n)\b/i;

export const shouldRoutePlanningPromptToRefine = (prompt: string): boolean => {
  const normalized = prompt.trim();
  if (!normalized) return false;
  return WORK_ITEM_ID_REGEX.test(normalized) && REFINEMENT_KEYWORD_REGEX.test(normalized);
};

export const inferPlanningSkillName = ({
  prompt,
  previousSkillName,
}: {
  prompt: string;
  previousSkillName?: string | null;
}): "ideate" | "refine" => {
  if (previousSkillName === "refine") return "refine";
  return shouldRoutePlanningPromptToRefine(prompt) ? "refine" : "ideate";
};
