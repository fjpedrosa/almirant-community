import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WizardShellProps, OnboardingStepKey } from "../../domain/types";

const STEPS: { key: OnboardingStepKey; labelKey: string }[] = [
  { key: "admin", labelKey: "admin" },
  { key: "tailscale", labelKey: "tailscale" },
  { key: "github", labelKey: "github" },
];

const stepDoneMap = (
  adminDone: boolean,
  tailscaleDone: boolean,
  githubDone: boolean,
): Record<OnboardingStepKey, boolean> => ({
  admin: adminDone,
  tailscale: tailscaleDone,
  github: githubDone,
});

const getNextPendingStep = (
  currentStep: OnboardingStepKey,
  doneFlags: Record<OnboardingStepKey, boolean>,
) => {
  if (!doneFlags[currentStep]) return null;

  const currentIndex = STEPS.findIndex((step) => step.key === currentStep);
  const orderedSteps = [
    ...STEPS.slice(currentIndex + 1),
    ...STEPS.slice(0, currentIndex),
  ];

  return orderedSteps.find((step) => !doneFlags[step.key]) ?? null;
};

export const WizardShell = ({
  currentStep,
  onStepChange,
  adminDone,
  tailscaleDone,
  githubDone,
  canComplete,
  isCompleting,
  onComplete,
  children,
}: WizardShellProps) => {
  const t = useTranslations("onboarding");
  const doneFlags = stepDoneMap(adminDone, tailscaleDone, githubDone);
  const nextPendingStep = getNextPendingStep(currentStep, doneFlags);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <div className="flex gap-8">
        {/* Sidebar steps */}
        <nav className="w-56 shrink-0 space-y-1">
          {STEPS.map(({ key, labelKey }) => {
            const done = doneFlags[key];
            const isActive = currentStep === key;

            return (
              <button
                key={key}
                type="button"
                onClick={() => onStepChange(key)}
                aria-current={isActive ? "step" : undefined}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                    done
                      ? "bg-green-600 text-white"
                      : "border border-muted-foreground/40"
                  }`}
                >
                  {done ? <Check className="h-3 w-3" /> : null}
                </span>
                {t(`steps.${labelKey}`)}
              </button>
            );
          })}
        </nav>

        {/* Step content */}
        <div className="min-w-0 flex-1">{children}</div>
      </div>

      {(nextPendingStep || canComplete) && (
        <div className="mt-10 flex justify-end gap-3">
          {nextPendingStep ? (
            <Button
              size="lg"
              variant={canComplete ? "secondary" : "default"}
              onClick={() => onStepChange(nextPendingStep.key)}
            >
              {t("continueToStep", {
                step: t(`steps.${nextPendingStep.labelKey}`),
              })}
            </Button>
          ) : null}

          {canComplete ? (
            <Button size="lg" onClick={onComplete} disabled={isCompleting}>
              {t("goToDashboard")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
};
