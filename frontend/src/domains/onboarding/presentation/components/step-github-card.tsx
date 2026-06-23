import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  Github,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type {
  GithubAppFormValues,
  StepGithubCardProps,
} from "../../domain/types";

const MANUAL_FIELDS: {
  key: keyof GithubAppFormValues;
  labelKey: string;
  type: "text" | "password" | "textarea";
}[] = [
  { key: "appId", labelKey: "appId", type: "text" },
  { key: "slug", labelKey: "slug", type: "text" },
  { key: "clientId", labelKey: "clientId", type: "text" },
  { key: "clientSecret", labelKey: "clientSecret", type: "password" },
  { key: "webhookSecret", labelKey: "webhookSecret", type: "password" },
  { key: "privateKeyPem", labelKey: "privateKeyPem", type: "textarea" },
];

export const StepGithubCard = ({
  activeTab,
  onTabChange,
  hasPublicUrl,
  isCreatingApp,
  onCreateViaManifest,
  manifestForm,
  onManifestFormChange,
  isManifestSubmittable,
  isTailscaleFunnel,
  formValues,
  onFormValueChange,
  isSaving,
  onSaveManual,
  configured,
  appSlug,
  hasInstallations,
  githubInstallUrl,
  isSyncingInstallations,
  onInstallGithubApp,
  onSyncInstallations,
  onCreateProject,
  isSkipping,
  onSkip,
  done,
}: StepGithubCardProps) => {
  const t = useTranslations("onboarding.github");

  if (done && appSlug) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            {t("titleDone")}
          </CardTitle>
          <CardDescription>
            {t("configuredAs", { slug: appSlug })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">
              {hasInstallations ? t("installDoneTitle") : t("installNextTitle")}
            </p>
            <p className="mt-1 text-muted-foreground">
              {hasInstallations
                ? t("installDoneDescription")
                : t("installNextDescription")}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={onInstallGithubApp}
              disabled={!githubInstallUrl}
              className="gap-2"
            >
              {t("installApp")}
              <ExternalLink className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              onClick={onSyncInstallations}
              disabled={isSyncingInstallations}
            >
              {isSyncingInstallations
                ? t("checkingInstallations")
                : t("syncInstallations")}
            </Button>

            <Button
              variant={hasInstallations ? "default" : "secondary"}
              onClick={onCreateProject}
            >
              {t("createProject")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const manifestDisabled =
    !hasPublicUrl || isCreatingApp || !isManifestSubmittable;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {configured && appSlug && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300">
            {t("alreadyConfigured", { slug: appSlug })}
          </div>
        )}

        {!configured && (
          <Tabs value={activeTab} onValueChange={onTabChange}>
            <TabsList>
              <TabsTrigger value="manifest">{t("tabManifest")}</TabsTrigger>
              <TabsTrigger value="manual">{t("tabManual")}</TabsTrigger>
            </TabsList>

            <TabsContent value="manifest" className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("manifestDescription")}
              </p>

              {!hasPublicUrl && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  {t("manifestNeedsUrl")}
                </p>
              )}

              {isTailscaleFunnel && (
                <Alert variant="default" className="border-amber-500/40">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <AlertDescription className="text-amber-800 dark:text-amber-300">
                    {t("tailscaleFunnelWarning")}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="github-app-name">{t("appNameLabel")}</Label>
                <Input
                  id="github-app-name"
                  type="text"
                  placeholder={t("appNamePlaceholder")}
                  value={manifestForm.appName}
                  onChange={(e) =>
                    onManifestFormChange("appName", e.target.value)
                  }
                  disabled={isCreatingApp}
                />
                <p className="text-xs text-muted-foreground">
                  {t("appNameHint")}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t("installTargetLabel")}</Label>
                <RadioGroup
                  value={manifestForm.installTarget}
                  onValueChange={(v) =>
                    onManifestFormChange("installTarget", v)
                  }
                  disabled={isCreatingApp}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem
                      value="personal"
                      id="install-target-personal"
                    />
                    <Label
                      htmlFor="install-target-personal"
                      className="font-normal"
                    >
                      {t("installTargetPersonal")}
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="org" id="install-target-org" />
                    <Label htmlFor="install-target-org" className="font-normal">
                      {t("installTargetOrg")}
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {manifestForm.installTarget === "org" && (
                <div className="space-y-1.5">
                  <Label htmlFor="github-org-slug">{t("orgSlugLabel")}</Label>
                  <Input
                    id="github-org-slug"
                    type="text"
                    placeholder={t("orgSlugPlaceholder")}
                    value={manifestForm.orgSlug}
                    onChange={(e) =>
                      onManifestFormChange("orgSlug", e.target.value)
                    }
                    disabled={isCreatingApp}
                  />
                </div>
              )}

              <Button onClick={onCreateViaManifest} disabled={manifestDisabled}>
                {isCreatingApp ? t("creatingApp") : t("createGithubApp")}
              </Button>
            </TabsContent>

            <TabsContent value="manual" className="mt-4 space-y-4">
              {MANUAL_FIELDS.map(({ key, labelKey, type }) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`github-${key}`}>
                    {t(`fields.${labelKey}`)}
                  </Label>
                  {type === "textarea" ? (
                    <Textarea
                      id={`github-${key}`}
                      className="min-h-[100px] font-mono"
                      value={formValues[key]}
                      onChange={(e) => onFormValueChange(key, e.target.value)}
                      disabled={isSaving}
                    />
                  ) : (
                    <Input
                      id={`github-${key}`}
                      type={type}
                      value={formValues[key]}
                      onChange={(e) => onFormValueChange(key, e.target.value)}
                      disabled={isSaving}
                    />
                  )}
                </div>
              ))}
              <Button
                onClick={onSaveManual}
                disabled={
                  isSaving ||
                  !formValues.appId ||
                  !formValues.slug ||
                  !formValues.clientId ||
                  !formValues.privateKeyPem
                }
              >
                {isSaving ? t("saving") : t("saveCredentials")}
              </Button>
            </TabsContent>
          </Tabs>
        )}

        <div className="border-t pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onSkip}
            disabled={isSkipping}
          >
            {t("skip")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
