import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import type { AiSuggestionsSectionProps } from "../../domain/types";

// --- Pure helper functions (no hooks) ---

const parseConfidence = (raw: string | null): number | null => {
  if (raw === null) return null;
  const parsed = parseFloat(raw);
  if (Number.isNaN(parsed)) return null;
  return parsed;
};

const getConfidenceColor = (value: number): string => {
  if (value >= 0.7) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (value >= 0.5) return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-red-100 text-red-800 border-red-200";
};

const getConfidenceLabel = (value: number): string => {
  if (value >= 0.7) return "High";
  if (value >= 0.5) return "Medium";
  return "Low";
};

const workItemTypeColors: Record<string, string> = {
  task: "bg-blue-100 text-blue-800 border-blue-200",
  story: "bg-violet-100 text-violet-800 border-violet-200",
  feature: "bg-emerald-100 text-emerald-800 border-emerald-200",
  epic: "bg-orange-100 text-orange-800 border-orange-200",
};

const categoryLabels: Record<string, string> = {
  bug: "Bug",
  feature_request: "Feature Request",
  improvement: "Improvement",
  question: "Question",
  praise: "Praise",
  other: "Other",
};

const hasAnySuggestion = (props: AiSuggestionsSectionProps): boolean => {
  return (
    props.aiSuggestedType !== null ||
    props.aiSuggestedTitle !== null ||
    props.aiSuggestedSummary !== null ||
    props.aiCategory !== null ||
    props.aiConfidence !== null ||
    props.aiReasoning !== null
  );
};

// Usage:
// <AiSuggestionsSection
//   aiSuggestedType={feedbackItem.aiSuggestedType}
//   aiSuggestedTitle={feedbackItem.aiSuggestedTitle}
//   aiSuggestedSummary={feedbackItem.aiSuggestedSummary}
//   aiCategory={feedbackItem.aiCategory}
//   aiConfidence={feedbackItem.aiConfidence}
//   aiReasoning={feedbackItem.aiReasoning}
// />

export const AiSuggestionsSection: React.FC<
  AiSuggestionsSectionProps & {
    reasoningOpen?: boolean;
    onReasoningToggle?: () => void;
  }
> = ({
  aiSuggestedType,
  aiSuggestedTitle,
  aiSuggestedSummary,
  aiCategory,
  aiConfidence,
  aiReasoning,
  reasoningOpen = false,
  onReasoningToggle,
}) => {
  if (!hasAnySuggestion({ aiSuggestedType, aiSuggestedTitle, aiSuggestedSummary, aiCategory, aiConfidence, aiReasoning })) {
    return null;
  }

  const confidence = parseConfidence(aiConfidence);

  return (
    <Card className="border-dashed border-purple-200 bg-purple-50/50 py-3 gap-3">
      <CardHeader className="pb-0 px-4">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 text-purple-700">
            <Sparkles className="h-4 w-4" />
            AI Suggestions
          </span>
          {confidence !== null && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={`text-xs font-medium ${getConfidenceColor(confidence)}`}
                  >
                    {Math.round(confidence * 100)}% confidence
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{getConfidenceLabel(confidence)} confidence in AI suggestions</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 space-y-2.5">
        {/* Type and Category badges */}
        {(aiSuggestedType || aiCategory) && (
          <div className="flex flex-wrap items-center gap-2">
            {aiSuggestedType && (
              <Badge
                variant="outline"
                className={`text-xs capitalize ${workItemTypeColors[aiSuggestedType] ?? ""}`}
              >
                {aiSuggestedType}
              </Badge>
            )}
            {aiCategory && (
              <Badge variant="secondary" className="text-xs">
                {categoryLabels[aiCategory] ?? aiCategory}
              </Badge>
            )}
          </div>
        )}

        {/* Suggested title */}
        {aiSuggestedTitle && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-0.5">Suggested title</p>
            <p className="text-sm text-foreground">{aiSuggestedTitle}</p>
          </div>
        )}

        {/* Suggested summary */}
        {aiSuggestedSummary && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-0.5">Suggested summary</p>
            <p className="text-sm text-foreground leading-relaxed">{aiSuggestedSummary}</p>
          </div>
        )}

        {/* Reasoning - collapsible */}
        {aiReasoning && (
          <div className="pt-1 border-t border-purple-200/60">
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left"
              onClick={onReasoningToggle}
              aria-expanded={reasoningOpen}
            >
              {reasoningOpen ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              AI reasoning
            </button>
            {reasoningOpen && (
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed pl-4">
                {aiReasoning}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
