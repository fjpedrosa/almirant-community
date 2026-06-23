import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Component: AskInput
// ---------------------------------------------------------------------------
// Chat-style input for submitting questions. Matches the visual style of
// the AI Planning chat input (rounded container, inline send button).
// ---------------------------------------------------------------------------

export interface AskInputProps {
  onSubmit: (question: string) => void;
  isLoading: boolean;
  placeholder?: string;
  disabled?: boolean;
}

export const AskInput: React.FC<AskInputProps> = ({
  onSubmit,
  isLoading,
  placeholder,
  disabled = false,
}) => {
  const t = useTranslations("ask");
  const [value, setValue] = useState("");
  const effectivePlaceholder = placeholder ?? t("input.placeholder");
  const canSend = value.trim().length > 0 && !isLoading && !disabled;

  const handleSubmit = () => {
    if (!canSend) return;
    onSubmit(value.trim());
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="px-4 pb-3 pt-1 shrink-0">
      <div className="max-w-3xl mx-auto rounded-2xl border-2 border-border bg-accent p-3">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={effectivePlaceholder}
          disabled={isLoading || disabled}
          autoComplete="off"
          className={cn(
            "border-0 shadow-none focus-visible:ring-0 bg-transparent! min-h-[44px] max-h-[200px] resize-none px-1 py-0 text-base",
            (isLoading || disabled) && "opacity-60"
          )}
          rows={1}
          aria-label={t("input.ariaLabel")}
        />
        <div className="flex items-center justify-end mt-2">
          <Button
            type="button"
            size="icon"
            disabled={!canSend}
            onClick={handleSubmit}
            className="rounded-full shrink-0 size-10"
            aria-label={
              isLoading
                ? t("input.submittingAriaLabel")
                : t("input.submitAriaLabel")
            }
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowUp className="size-5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
