import { useTranslations } from "next-intl";
import type { SignInCardProps } from "../../domain/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export const SignInCard = ({
  mode,
  values,
  onValueChange,
  onSubmit,
  isLoading,
  error,
}: SignInCardProps) => {
  const t = useTranslations("auth");
  const isInitialAdminSetup = mode === "initial_admin_setup";
  const isSignUp = isInitialAdminSetup || mode === "sign_up";
  const cardTitle = isInitialAdminSetup ? t("createAdminTitle") : t("title");
  const cardDescription = isInitialAdminSetup
    ? t("createAdminDescription")
    : isSignUp
      ? t("invitedSignupDescription")
      : t("signInToContinue");

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">{cardTitle}</CardTitle>
        <CardDescription>{cardDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit();
          }}
        >
          {isSignUp && (
            <div className="space-y-1">
              <Label htmlFor="name">{t("name")}</Label>
              <Input
                id="name"
                autoComplete="name"
                value={values.name}
                onChange={(event) => onValueChange("name", event.target.value)}
                disabled={isLoading}
              />
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={(event) => onValueChange("email", event.target.value)}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="password">{t("password")}</Label>
            <Input
              id="password"
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              value={values.password}
              onChange={(event) => onValueChange("password", event.target.value)}
              disabled={isLoading}
            />
          </div>

          {isSignUp && (
            <div className="space-y-1">
              <Label htmlFor="confirm-password">{t("confirmPassword")}</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={values.confirmPassword}
                onChange={(event) =>
                  onValueChange("confirmPassword", event.target.value)
                }
                disabled={isLoading}
              />
            </div>
          )}

          {isInitialAdminSetup && (
            <p className="text-xs text-muted-foreground">{t("setupHint")}</p>
          )}

          {!isInitialAdminSetup && mode === "sign_up" && (
            <p className="text-xs text-muted-foreground">
              {t("invitedSignupHint")}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {isInitialAdminSetup
              ? t("completeSetup")
              : isSignUp
                ? t("createAccount")
                : t("signIn")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
