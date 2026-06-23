import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

type ResumeStep = "queued" | "loading" | "restoring" | "ready";

interface ResumeStepperProps {
  currentStep: ResumeStep;
}

const STEPS: ResumeStep[] = ["queued", "loading", "restoring", "ready"];

export const ResumeStepper: React.FC<ResumeStepperProps> = ({ currentStep }) => {
  const t = useTranslations("aiPlanning");
  const currentIndex = STEPS.indexOf(currentStep);

  return (
    <div className="mx-auto flex max-w-xs flex-col gap-3 p-8">
      {STEPS.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;

        return (
          <div key={step} className="flex items-center gap-3">
            <div className="flex size-6 shrink-0 items-center justify-center">
              {isCompleted ? (
                <Check className="size-4 text-primary" />
              ) : isCurrent ? (
                <Loader2 className="size-4 animate-spin text-primary" />
              ) : (
                <div className="size-2 rounded-full bg-muted-foreground/30" />
              )}
            </div>
            <span
              className={`text-sm ${
                isCompleted
                  ? "text-muted-foreground"
                  : isCurrent
                    ? "font-medium text-foreground"
                    : "text-muted-foreground/50"
              }`}
            >
              {t(`resumeStepper.${step}`)}
            </span>
          </div>
        );
      })}
    </div>
  );
};
