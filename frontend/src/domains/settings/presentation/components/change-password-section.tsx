import { useTranslations } from "next-intl";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChangePasswordSectionProps } from "../../domain/types";

export const ChangePasswordSection: React.FC<ChangePasswordSectionProps> = ({
  values,
  isSubmitting,
  error,
  onValueChange,
  onSubmit,
}) => {
  const t = useTranslations("settings");

  return (
    <section className="space-y-4" aria-labelledby="change-password-title">
      <div className="flex items-start gap-3">
        <div className="rounded-lg border bg-muted/40 p-2 text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <div>
          <h3 id="change-password-title" className="text-sm font-medium">
            {t("security.title")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t("security.description")}
          </p>
        </div>
      </div>

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="current-password">
            {t("security.currentPassword")}
          </Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={values.currentPassword}
            disabled={isSubmitting}
            onChange={(event) =>
              onValueChange("currentPassword", event.target.value)
            }
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="new-password">{t("security.newPassword")}</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={values.newPassword}
              disabled={isSubmitting}
              onChange={(event) =>
                onValueChange("newPassword", event.target.value)
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">
              {t("security.confirmPassword")}
            </Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={values.confirmPassword}
              disabled={isSubmitting}
              onChange={(event) =>
                onValueChange("confirmPassword", event.target.value)
              }
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{t("security.hint")}</p>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isSubmitting ? t("security.saving") : t("security.save")}
        </Button>
      </form>
    </section>
  );
};
