import { useTranslations } from "next-intl";
import type { AcceptInvitationCardProps } from "../../domain/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, MailOpen, LogIn } from "lucide-react";

export const AcceptInvitationCard = ({
  status,
  message,
  onSignIn,
}: AcceptInvitationCardProps) => {
  const t = useTranslations("auth.acceptInvitation");

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          {status === "loading" || status === "accepting" ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : status === "success" ? (
            <CheckCircle2 className="h-6 w-6 text-green-600" />
          ) : status === "error" ? (
            <XCircle className="h-6 w-6 text-destructive" />
          ) : (
            <MailOpen className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        <CardTitle className="text-xl font-bold">{t("title")}</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {status === "auth_required" && (
          <Button variant="outline" className="w-full" onClick={onSignIn}>
            <LogIn className="mr-2 h-4 w-4" />
            {t("signInToAccept")}
          </Button>
        )}

        {status === "error" && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => (window.location.href = "/")}
          >
            {t("goHome")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
