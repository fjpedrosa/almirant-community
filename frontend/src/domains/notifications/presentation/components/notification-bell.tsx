import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  CheckCircle2,
  GitPullRequest,
  MessageSquareText,
} from "lucide-react";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { NotificationBellProps, Notification } from "../../domain/types";
import { getNotificationVisual } from "../../domain/notification-visuals";

const getInitials = (name: string): string => {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

const NotificationRow: React.FC<{
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onClick: (notification: Notification) => void;
}> = ({ notification, onMarkAsRead, onClick }) => {
  const { formatRelative } = useFormattedDate();
  const timeAgo = formatRelative(notification.createdAt);
  const visual = getNotificationVisual(notification);

  const fallbackIcon =
    visual.fallbackIcon === "alert" ? (
      <AlertTriangle className={`h-3.5 w-3.5 ${visual.iconClass}`} />
    ) : visual.fallbackIcon === "success" ? (
      <CheckCircle2 className={`h-3.5 w-3.5 ${visual.iconClass}`} />
    ) : visual.fallbackIcon === "pr" ? (
      <GitPullRequest className={`h-3.5 w-3.5 ${visual.iconClass}`} />
    ) : visual.fallbackIcon === "comment" ? (
      <MessageSquareText className={`h-3.5 w-3.5 ${visual.iconClass}`} />
    ) : (
      <Bell className={`h-3.5 w-3.5 ${visual.iconClass}`} />
    );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick(notification)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick(notification);
        }
      }}
      className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/50 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${visual.rowClass} ${
        notification.isRead ? "opacity-60" : ""
      }`}
    >
      {notification.actor ? (
        <Avatar className="h-6 w-6 shrink-0">
          <AvatarImage src={notification.actor.image ?? undefined} alt={notification.actor.name} />
          <AvatarFallback className="text-[10px]">{getInitials(notification.actor.name)}</AvatarFallback>
        </Avatar>
      ) : (
        <div className="shrink-0 mt-0.5">
          {fallbackIcon}
        </div>
      )}

      <div className="flex-1 min-w-0 max-w-[280px]">
        <p className={`text-sm leading-snug truncate ${notification.isRead ? "text-muted-foreground" : "font-medium text-foreground"}`}>
          {notification.title}
        </p>
        {notification.body && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{notification.body}</p>
        )}
        <p className="text-[11px] text-muted-foreground mt-0.5">{timeAgo}</p>
      </div>

      {!notification.isRead && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMarkAsRead(notification.id);
          }}
          className="shrink-0 mt-1 p-1 rounded hover:bg-muted transition-colors"
          title="Marcar como leida"
        >
          <Check className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}

      {!notification.isRead && (
        <div className={`shrink-0 mt-2.5 h-2 w-2 rounded-full ${visual.unreadDotClass}`} />
      )}
    </div>
  );
};

export const NotificationBell: React.FC<NotificationBellProps> = ({
  unreadCount,
  notifications,
  isLoading,
  onMarkAsRead,
  onMarkAllAsRead,
  onNotificationClick,
}) => {
  const t = useTranslations("notifications.bell");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9" aria-label="Notifications">
          <Bell className="h-4.5 w-4.5" />
          {unreadCount > 0 && (
            <span className="absolute top-0 right-0 inline-flex items-center justify-center h-4 min-w-4 px-0.5 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold leading-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[380px] p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3">
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={onMarkAllAsRead}
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              {t("markAllAsRead")}
            </Button>
          )}
        </div>

        <Separator />

        {/* Notification list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <BellOff className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm font-medium text-muted-foreground">{t("empty")}</p>
            <p className="text-xs text-muted-foreground/70 mt-1">{t("emptyHint")}</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <div className="py-1">
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={onMarkAsRead}
                  onClick={onNotificationClick}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        <Separator />

        {/* Footer */}
        <div className="px-4 py-2.5">
          <Link
            href="/notifications"
            className="block text-center text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            {t("viewAll")}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
};
