import { useTranslations } from "next-intl";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { QuestionCardProps } from "../../domain/types";

/** Parse "label::description" format into parts. */
const parseOption = (raw: string): { label: string; description?: string } => {
  const sepIdx = raw.indexOf("::");
  if (sepIdx === -1) return { label: raw };
  return { label: raw.slice(0, sepIdx), description: raw.slice(sepIdx + 2) };
};

export const QuestionCard: React.FC<QuestionCardProps> = ({
  questionText,
  options,
  onSelectOption,
  isSubmitting,
  inputRef,
  onFormSubmit,
}) => {
  const t = useTranslations("aiPlanning.questionCard");
  const parsedOptions = options.map(parseOption);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out">
      {/* Question title */}
      <p className="text-base font-medium text-foreground px-1 pb-1">{questionText}</p>

      {/* Option cards with label + description */}
      {parsedOptions.length > 0 && (
        <div className="flex flex-col gap-1.5 px-1 py-2">
          {parsedOptions.map(({ label, description }) => (
            <button
              key={label}
              type="button"
              disabled={isSubmitting}
              onClick={() => onSelectOption(label)}
              className="
                text-left rounded-lg border border-border/60 bg-background
                px-3 py-2 transition-all duration-150 ease-out
                hover:bg-accent hover:border-accent hover:shadow-sm
                active:shadow-none
                disabled:opacity-50 disabled:pointer-events-none
                cursor-pointer group
              "
            >
              <span className="text-sm font-medium text-foreground/90 group-hover:text-accent-foreground">
                {label}
              </span>
              {description && (
                <p className="text-xs text-muted-foreground mt-0.5 group-hover:text-accent-foreground/70">
                  {description}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Textarea */}
      <form onSubmit={onFormSubmit}>
        <Textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement | null>}
          name="freeText"
          placeholder={t("freeTextPlaceholder")}
          disabled={isSubmitting}
          className="border-0 shadow-none focus-visible:ring-0 bg-transparent! min-h-[44px] max-h-[200px] resize-none px-1 py-0 text-base md:text-sm"
          rows={1}
          onInput={(e) => {
            const target = e.currentTarget;
            target.style.height = "auto";
            target.style.height = `${Math.min(target.scrollHeight, 72)}px`;
          }}
        />
      </form>

      {/* Send button row */}
      <div className="flex items-center justify-end mt-2">
        <Button
          onClick={() => {
            const form = (inputRef?.current as HTMLElement | null)?.closest("form");
            if (form) form.requestSubmit();
          }}
          disabled={isSubmitting}
          size="icon"
          className="rounded-full shrink-0 size-10"
          aria-label={t("send")}
        >
          <ArrowUp className="size-5" />
        </Button>
      </div>
    </div>
  );
};
