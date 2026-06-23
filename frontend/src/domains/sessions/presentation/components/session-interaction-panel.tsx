import { MessageCircleQuestion, AlertTriangle, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { WorkerInteraction } from "@/domains/agents/domain/types";

interface SessionInteractionPanelProps {
  interaction: WorkerInteraction;
  answerText: string;
  onAnswerChange: (text: string) => void;
  onRespond: () => void;
  onRespondWithOption: (option: string) => void;
  isResponding: boolean;
  currentTime: number;
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `Expires in ${minutes}m ${seconds}s`;
  }
  return `Expires in ${seconds}s`;
}

export const SessionInteractionPanel: React.FC<SessionInteractionPanelProps> = ({
  interaction,
  answerText,
  onAnswerChange,
  onRespond,
  onRespondWithOption,
  isResponding,
  currentTime,
}) => {
  const isExpired = interaction.status === "expired";
  const expiresAt = interaction.expiresAt ? new Date(interaction.expiresAt).getTime() : null;
  const timeRemaining = expiresAt ? expiresAt - currentTime : null;
  const isAboutToExpire = timeRemaining !== null && timeRemaining > 0 && timeRemaining < 30_000;

  if (isExpired) {
    return (
      <div className="border-l-4 border-muted-foreground/40 bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>This question has expired</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground/80">
          {interaction.questionText}
        </p>
      </div>
    );
  }

  return (
    <div className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3 dark:bg-amber-950/20">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
          <MessageCircleQuestion className="h-4 w-4 shrink-0" />
          <span>Agent needs input</span>
        </div>
        {timeRemaining !== null && timeRemaining > 0 && (
          <span
            className={cn(
              "text-xs",
              isAboutToExpire
                ? "font-medium text-red-600 dark:text-red-400"
                : "text-muted-foreground",
            )}
          >
            {formatTimeRemaining(timeRemaining)}
          </span>
        )}
      </div>

      {/* Question text */}
      <p className="mt-2 text-sm text-foreground">{interaction.questionText}</p>

      {/* Options (if choice / approval type) */}
      {interaction.options && interaction.options.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {interaction.options.map((option) => (
            <Button
              key={option}
              variant="outline"
              size="sm"
              disabled={isResponding}
              onClick={() => onRespondWithOption(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      )}

      {/* Free text input */}
      <div className="mt-3 flex gap-2">
        <Textarea
          placeholder="Type your response..."
          value={answerText}
          onChange={(e) => onAnswerChange(e.target.value)}
          className="min-h-[60px] resize-none bg-background text-sm"
          rows={2}
          disabled={isResponding}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && answerText.trim()) {
              e.preventDefault();
              onRespond();
            }
          }}
        />
        <Button
          size="icon"
          disabled={!answerText.trim() || isResponding}
          onClick={onRespond}
          className="shrink-0 self-end"
        >
          {isResponding ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
};
