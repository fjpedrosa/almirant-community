import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Mail } from "lucide-react";
import type { NotificationPreferencesFormProps, NotificationType } from "../../domain/types";

const NOTIFICATION_TYPE_ORDER: NotificationType[] = [
  "assignment",
  "comment",
  "mention",
  "status_changed",
];

const NotificationPreferencesSkeleton: React.FC = () => (
  <Card>
    <CardHeader>
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-72" />
    </CardHeader>
    <CardContent>
      <div className="space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
            <div className="flex items-center gap-6">
              <Skeleton className="h-5 w-8 rounded-full" />
              <Skeleton className="h-5 w-8 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
);

export const NotificationPreferencesForm: React.FC<NotificationPreferencesFormProps> = ({
  preferences,
  isLoading,
  onToggle,
}) => {
  const t = useTranslations("notificationPreferences");

  if (isLoading) {
    return <NotificationPreferencesSkeleton />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Column headers */}
        <div className="mb-4 flex items-center justify-end gap-4 pr-0.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Bell className="h-3.5 w-3.5" />
            <span>{t("channels.inApp")}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Mail className="h-3.5 w-3.5" />
            <span>{t("channels.email")}</span>
          </div>
        </div>

        <div className="divide-y">
          {NOTIFICATION_TYPE_ORDER.map((type) => {
            const pref = preferences.find((p) => p.notificationType === type);
            const inAppEnabled = pref?.inAppEnabled ?? true;
            const emailEnabled = pref?.emailEnabled ?? true;

            return (
              <div
                key={type}
                className="flex items-center gap-8 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <p className="text-sm font-medium leading-none">
                    {t(`types.${type}.label`)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t(`types.${type}.description`)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <Switch
                    checked={inAppEnabled}
                    onCheckedChange={(checked) => onToggle(type, "inApp", checked)}
                    aria-label={`${t(`types.${type}.label`)} - ${t("channels.inApp")}`}
                  />
                  <Switch
                    checked={emailEnabled}
                    onCheckedChange={(checked) => onToggle(type, "email", checked)}
                    aria-label={`${t(`types.${type}.label`)} - ${t("channels.email")}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};
