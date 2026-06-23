"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Rocket } from "lucide-react";
import type { WizardStepVercelDeployProps } from "../../domain/types";

export const WizardStepVercelDeploy: React.FC<WizardStepVercelDeployProps> = ({
  deployToVercel,
  onToggleDeployToVercel,
  vercelProjectName,
  onVercelProjectNameChange,
  githubRepoFullName,
}) => {
  const t = useTranslations("projects.wizard.vercelDeploy");
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border p-4">
        <Switch
          checked={deployToVercel}
          onCheckedChange={onToggleDeployToVercel}
          id="deploy-vercel"
          aria-label={t("toggleLabel")}
        />
        <Label htmlFor="deploy-vercel" className="flex items-center gap-2 cursor-pointer">
          <Rocket className="h-4 w-4" />
          {t("createProject")}
        </Label>
      </div>

      {deployToVercel ? (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-2">
            <Label htmlFor="vercel-project-name">{t("projectName")}</Label>
            <Input
              id="vercel-project-name"
              value={vercelProjectName}
              onChange={(event) => onVercelProjectNameChange(event.target.value)}
              placeholder={t("projectNamePlaceholder")}
              autoFocus
            />
          </div>
          {githubRepoFullName ? (
            <p className="text-xs text-muted-foreground">
              {t("linkedRepo", { repoName: githubRepoFullName })}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("noRepo")}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("laterConfig")}
        </p>
      )}
    </div>
  );
};
