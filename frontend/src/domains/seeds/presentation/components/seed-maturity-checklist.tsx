"use client";

import { useTranslations } from "next-intl";
import { CheckCircle2, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

interface SeedMaturityChecklistProps {
  description: string | null;
  metadata: Record<string, unknown>;
}

interface CheckItemProps {
  label: string;
  completed: boolean;
}

const CheckItem: React.FC<CheckItemProps> = ({ label, completed }) => (
  <div className="flex items-center gap-2 py-0.5">
    {completed ? (
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
    ) : (
      <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
    )}
    <span
      className={cn(
        "text-xs",
        completed ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {label}
    </span>
  </div>
);

export const SeedMaturityChecklist: React.FC<SeedMaturityChecklistProps> = ({
  description,
  metadata,
}) => {
  const t = useTranslations("seeds.maturity.checklist");

  const hasDetailedDescription =
    typeof description === "string" && description.length > 50;

  const hasDefinitionOfDone =
    typeof metadata.definitionOfDone === "string" &&
    metadata.definitionOfDone.trim().length > 0;

  const hasImplementationProposal =
    typeof metadata.implementationProposal === "string" &&
    metadata.implementationProposal.trim().length > 0;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">
          {t("level2")}
        </p>
        <CheckItem
          label={t("detailedDescription")}
          completed={hasDetailedDescription}
        />
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-1">
          {t("level3")}
        </p>
        <CheckItem
          label={t("definitionOfDone")}
          completed={hasDefinitionOfDone}
        />
        <CheckItem
          label={t("implementationProposal")}
          completed={hasImplementationProposal}
        />
      </div>
    </div>
  );
};
