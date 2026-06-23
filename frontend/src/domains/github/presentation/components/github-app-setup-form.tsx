import { useTranslations } from "next-intl";
import { Github, AlertTriangle, CheckCircle2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { GithubAppSetupFormProps } from "../../domain/types";
import type { GithubAppFormValues } from "@/domains/onboarding/domain/types";

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

export const GithubAppSetupForm: React.FC<GithubAppSetupFormProps> = ({
  formValues,
  onValueChange,
  onSubmit,
  onManifestClick,
  isSubmitting,
  isManifestDisabled,
  manifestDisabledReason,
  manifestForm,
  onManifestFormChange,
  isManifestSubmittable,
  isTailscaleFunnel,
  error,
  success,
}) => {
  const t = useTranslations("github.appSetup");
  const tWizard = useTranslations("onboarding.github");

  const manifestButtonDisabled =
    isManifestDisabled || !isManifestSubmittable;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            {t("title")}
          </CardTitle>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {t("recommendedBadge")}
          </span>
        </div>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300">
            {t("saved")}
          </div>
        )}

        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="text-sm text-muted-foreground">{t("guidedIntro")}</p>
        </div>

        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              1
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("stepPublicUrlTitle")}</p>
              <p className="text-sm text-muted-foreground">
                {t("stepPublicUrlDescription")}
              </p>
              {isManifestDisabled && manifestDisabledReason && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  {manifestDisabledReason}
                </p>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              2
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-medium">{t("stepNameTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("stepNameDescription")}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="github-setup-app-name">
                  {tWizard("appNameLabel")}
                </Label>
                <Input
                  id="github-setup-app-name"
                  type="text"
                  placeholder={tWizard("appNamePlaceholder")}
                  value={manifestForm.appName}
                  onChange={(e) =>
                    onManifestFormChange("appName", e.target.value)
                  }
                  disabled={isManifestDisabled}
                />
                <p className="text-xs text-muted-foreground">
                  {tWizard("appNameHint")}
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              3
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-medium">{t("stepOwnerTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("stepOwnerDescription")}
                </p>
              </div>
              <RadioGroup
                value={manifestForm.installTarget}
                onValueChange={(v) =>
                  onManifestFormChange("installTarget", v)
                }
                disabled={isManifestDisabled}
                className="grid gap-2 sm:grid-cols-2"
              >
                <Label
                  htmlFor="setup-install-personal"
                  className="flex cursor-pointer items-center gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem
                    value="personal"
                    id="setup-install-personal"
                  />
                  <span>{tWizard("installTargetPersonal")}</span>
                </Label>
                <Label
                  htmlFor="setup-install-org"
                  className="flex cursor-pointer items-center gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                >
                  <RadioGroupItem value="org" id="setup-install-org" />
                  <span>{tWizard("installTargetOrg")}</span>
                </Label>
              </RadioGroup>

              {manifestForm.installTarget === "org" && (
                <div className="space-y-1.5">
                  <Label htmlFor="github-setup-org-slug">
                    {tWizard("orgSlugLabel")}
                  </Label>
                  <Input
                    id="github-setup-org-slug"
                    type="text"
                    placeholder={tWizard("orgSlugPlaceholder")}
                    value={manifestForm.orgSlug}
                    onChange={(e) =>
                      onManifestFormChange("orgSlug", e.target.value)
                    }
                    disabled={isManifestDisabled}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {isTailscaleFunnel && (
          <Alert variant="default" className="border-amber-500/40">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-amber-800 dark:text-amber-300">
              {tWizard("tailscaleFunnelWarning")}
            </AlertDescription>
          </Alert>
        )}

        <Button onClick={onManifestClick} disabled={manifestButtonDisabled}>
          <CheckCircle2 className="h-4 w-4" />
          {isManifestDisabled ? t("createApp") : tWizard("createGithubApp")}
        </Button>

        <details className="group rounded-lg border p-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium">
            <Settings2 className="h-4 w-4" />
            {t("advancedManualTitle")}
          </summary>
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("manualDescription")}
            </p>

            {MANUAL_FIELDS.map(({ key, labelKey, type }) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`github-setup-${key}`}>
                  {t(`fields.${labelKey}`)}
                </Label>
                {type === "textarea" ? (
                  <Textarea
                    id={`github-setup-${key}`}
                    className="min-h-[100px] font-mono"
                    value={formValues[key]}
                    onChange={(e) => onValueChange(key, e.target.value)}
                    disabled={isSubmitting}
                  />
                ) : (
                  <Input
                    id={`github-setup-${key}`}
                    type={type}
                    value={formValues[key]}
                    onChange={(e) => onValueChange(key, e.target.value)}
                    disabled={isSubmitting}
                  />
                )}
              </div>
            ))}
            <Button
              variant="outline"
              onClick={onSubmit}
              disabled={
                isSubmitting ||
                !formValues.appId ||
                !formValues.slug ||
                !formValues.clientId ||
                !formValues.privateKeyPem
              }
            >
              {isSubmitting ? t("saving") : t("save")}
            </Button>
          </div>
        </details>
      </CardContent>
    </Card>
  );
};
