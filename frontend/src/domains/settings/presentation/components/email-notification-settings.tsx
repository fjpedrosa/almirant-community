import { useTranslations } from "next-intl";
import { Mail } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { EmailNotificationSettingsProps, EmailNotificationToggleKey } from "../../domain/types";

interface NotificationEventConfig {
  key: EmailNotificationToggleKey;
  titleKey: string;
  descKey: string;
}

const notificationEvents: NotificationEventConfig[] = [
  { key: "notifyWorkItemMoved", titleKey: "workItemMoved", descKey: "workItemMovedDesc" },
  { key: "notifyWorkItemAssigned", titleKey: "workItemAssigned", descKey: "workItemAssignedDesc" },
  { key: "notifyWorkItemDone", titleKey: "workItemDone", descKey: "workItemDoneDesc" },
  { key: "notifyReviewCompleted", titleKey: "reviewCompleted", descKey: "reviewCompletedDesc" },
  { key: "notifySprintClosed", titleKey: "sprintClosed", descKey: "sprintClosedDesc" },
  { key: "notifyUserActions", titleKey: "userActions", descKey: "userActionsDesc" },
];

export const EmailNotificationSettings: React.FC<EmailNotificationSettingsProps> = ({
  settings,
  isSaving,
  onToggle,
}) => {
  const t = useTranslations("settings.emailNotifications");

  const isEnabled = settings?.enabled ?? false;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-muted-foreground" />
          <CardTitle>{t("title")}</CardTitle>
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Master toggle */}
        <div className="flex items-center gap-4 sm:gap-8">
          <div className="flex-1 min-w-0 space-y-0.5">
            <Label htmlFor="email-notifications-enabled" className="text-sm font-medium">
              {t("enabled")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("enabledDesc")}
            </p>
          </div>
          <Switch
            id="email-notifications-enabled"
            checked={isEnabled}
            onCheckedChange={(checked) => onToggle("enabled", checked)}
            disabled={isSaving}
            aria-label={t("enabled")}
            className="shrink-0"
          />
        </div>

        <Separator />

        {/* Individual event toggles */}
        <div className="space-y-1">
          <h4 className="text-sm font-medium">{t("events")}</h4>
          <p className="text-xs text-muted-foreground">{t("eventsDesc")}</p>
        </div>

        <div
          className={`space-y-3 transition-opacity ${
            !isEnabled ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          {notificationEvents.map((event) => (
            <div
              key={event.key}
              className="flex items-center gap-4 sm:gap-8"
            >
              <div className="flex-1 min-w-0 space-y-0.5">
                <Label
                  htmlFor={`email-notification-${event.key}`}
                  className="text-sm font-medium"
                >
                  {t(event.titleKey)}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t(event.descKey)}
                </p>
              </div>
              <Switch
                id={`email-notification-${event.key}`}
                checked={settings?.[event.key] ?? false}
                onCheckedChange={(checked) => onToggle(event.key, checked)}
                disabled={!isEnabled || isSaving}
                aria-label={t(event.titleKey)}
                className="shrink-0"
              />
            </div>
          ))}
        </div>

        {isSaving && (
          <p className="text-xs text-muted-foreground">{t("saving")}</p>
        )}
      </CardContent>
    </Card>
  );
};
