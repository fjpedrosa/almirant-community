import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { StepAdminCardProps } from "../../domain/types";

export const StepAdminCard = ({ userCount, adminEmail }: StepAdminCardProps) => {
  const t = useTranslations("onboarding.admin");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("email")}:</span>
          <span className="font-medium">{adminEmail}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("userCount")}:</span>
          <span className="font-medium">{userCount}</span>
        </div>
      </CardContent>
    </Card>
  );
};
