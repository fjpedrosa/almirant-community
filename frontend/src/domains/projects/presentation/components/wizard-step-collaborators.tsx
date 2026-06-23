"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import type { WizardStepCollaboratorsProps } from "../../domain/types";

export const WizardStepCollaborators: React.FC<WizardStepCollaboratorsProps> = ({
  collaboratorEmails,
  collaboratorInput,
  onCollaboratorInputChange,
  onAddCollaborator,
  onRemoveCollaborator,
}) => {
  const t = useTranslations("projects.wizard.collaborators");

  const handleAdd = () => {
    if (!collaboratorInput.trim()) return;
    onAddCollaborator(collaboratorInput);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("optionalStep")}
        </p>
      </div>
      <div className="flex gap-2">
        <Input
          value={collaboratorInput}
          onChange={(event) => onCollaboratorInputChange(event.target.value)}
          placeholder={t("placeholder")}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleAdd();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={handleAdd}>
          {t("add")}
        </Button>
      </div>
      {collaboratorEmails.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {collaboratorEmails.map((collaboratorEmail) => (
            <Badge key={collaboratorEmail} className="gap-1">
              {collaboratorEmail}
              <button
                type="button"
                onClick={() => onRemoveCollaborator(collaboratorEmail)}
                aria-label={t("removeAriaLabel", { email: collaboratorEmail })}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </div>
  );
};
