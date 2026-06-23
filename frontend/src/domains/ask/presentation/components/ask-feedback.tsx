import { useTranslations } from "next-intl";
import { ThumbsUp, ThumbsDown, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  AskFeedbackRating,
  AskFeedbackCategory,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Component: AskFeedback
// ---------------------------------------------------------------------------
// Renders thumbs up/down feedback controls for an Ask response. After the
// user picks a rating, an optional category selector and comment textarea
// are revealed. Pure presentational -- all state and handlers come via props.
// ---------------------------------------------------------------------------

const FEEDBACK_CATEGORY_KEYS: AskFeedbackCategory[] = [
  "accuracy",
  "citations",
  "relevance",
  "completeness",
  "other",
];

export interface AskFeedbackProps {
  /** Whether a rating has already been submitted for this session */
  hasRated: boolean;
  /** The rating that was submitted (if any) */
  currentRating: AskFeedbackRating | null;
  /** Whether the expanded form (category + comment) is visible */
  isExpanded: boolean;
  /** Currently selected category in the expanded form */
  selectedCategory: AskFeedbackCategory | undefined;
  /** Current comment text in the expanded form */
  comment: string;
  /** Whether a feedback submission is in progress */
  isSubmitting: boolean;
  /** Called when user clicks thumbs up or down */
  onRate: (rating: AskFeedbackRating) => void;
  /** Called when user selects a feedback category */
  onCategoryChange: (category: AskFeedbackCategory | undefined) => void;
  /** Called when user types in the comment textarea */
  onCommentChange: (comment: string) => void;
  /** Called when user submits the expanded feedback form */
  onSubmitDetails: () => void;
  /** Called to dismiss the expanded form */
  onDismissExpanded: () => void;
}

export const AskFeedback: React.FC<AskFeedbackProps> = ({
  hasRated,
  currentRating,
  isExpanded,
  selectedCategory,
  comment,
  isSubmitting,
  onRate,
  onCategoryChange,
  onCommentChange,
  onSubmitDetails,
  onDismissExpanded,
}) => {
  const t = useTranslations("ask");

  // After rating is submitted and expanded form is dismissed
  if (hasRated && !isExpanded) {
    return (
      <div className="flex items-center gap-2 pt-3 text-xs text-muted-foreground">
        <span>{t("feedback.thanks")}</span>
        <ThumbsUp
          className={cn(
            "size-3.5",
            currentRating === "helpful" && "text-green-600 dark:text-green-400",
          )}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-3">
      {/* Rating buttons */}
      {!hasRated && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t("feedback.wasHelpful")}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => onRate("helpful")}
              disabled={isSubmitting}
            >
              <ThumbsUp className="size-3.5" />
              {t("feedback.yes")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => onRate("not_helpful")}
              disabled={isSubmitting}
            >
              <ThumbsDown className="size-3.5" />
              {t("feedback.no")}
            </Button>
          </div>
        </div>
      )}

      {/* Expanded feedback form */}
      {isExpanded && (
        <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-xs font-medium text-foreground">
            {currentRating === "helpful"
              ? t("feedback.likedPrompt")
              : t("feedback.improvePrompt")}
          </p>

          {/* Category badges */}
          <div className="flex flex-wrap gap-1.5">
            {FEEDBACK_CATEGORY_KEYS.map((catKey) => (
              <Badge
                key={catKey}
                variant={
                  selectedCategory === catKey ? "default" : "outline"
                }
                className="cursor-pointer text-xs"
                onClick={() =>
                  onCategoryChange(
                    selectedCategory === catKey ? undefined : catKey,
                  )
                }
              >
                {t(`feedback.categories.${catKey}`)}
              </Badge>
            ))}
          </div>

          {/* Comment textarea */}
          <Textarea
            placeholder={t("feedback.commentPlaceholder")}
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            className="min-h-[60px] resize-none text-sm"
            maxLength={2000}
          />

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={onDismissExpanded}
            >
              {t("feedback.skip")}
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={onSubmitDetails}
              disabled={isSubmitting}
            >
              <Send className="size-3" />
              {t("feedback.submit")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
