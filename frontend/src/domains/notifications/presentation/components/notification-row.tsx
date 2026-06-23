import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  GitPullRequest,
  MessageSquare,
  MessageSquareText,
  AtSign,
  ArrowRightLeft,
} from "lucide-react";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { NotificationRowProps, NotificationType } from "../../domain/types";
import { getNotificationVisual } from "../../domain/notification-visuals";

const TYPE_CONFIG: Record<NotificationType, { icon: React.ElementType; label: string }> = {
  assignment: { icon: Bell, label: "Asignacion" },
  comment: { icon: MessageSquare, label: "Comentario" },
  mention: { icon: AtSign, label: "Mencion" },
  status_changed: { icon: ArrowRightLeft, label: "Estado" },
};

const FALLBACK_ICON_MAP = {
  alert: AlertTriangle,
  success: CheckCircle2,
  pr: GitPullRequest,
  comment: MessageSquareText,
  bell: Bell,
} as const;

const getInitials = (name: string): string => {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

export const NotificationRow: React.FC<NotificationRowProps> = ({
  notification,
  onMarkAsRead,
  onClick,
}) => {
  const { formatRelative } = useFormattedDate();
  const config = TYPE_CONFIG[notification.type];
  const Icon = config.icon;
  const visual = getNotificationVisual(notification);
  const isGithubNotification = visual.fallbackIcon !== "bell";

  const timeAgo = formatRelative(notification.createdAt);

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "flex items-start gap-4 px-4 py-3 rounded-lg cursor-pointer transition-colors",
        "hover:bg-muted/50",
        visual.rowClass,
        !notification.isRead && !isGithubNotification && "bg-blue-50/50 dark:bg-blue-950/20"
      )}
      onClick={() => onClick(notification)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(notification);
        }
      }}
    >
      {/* Unread indicator */}
      <div className="flex items-center pt-2">
        <div
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            !notification.isRead ? visual.unreadDotClass : "bg-transparent"
          )}
        />
      </div>

      {/* Actor avatar or fallback icon */}
      {notification.actor && !isGithubNotification ? (
        <Avatar className="h-9 w-9 shrink-0">
          {notification.actor.image && (
            <AvatarImage src={notification.actor.image} alt={notification.actor.name} />
          )}
          <AvatarFallback className="text-xs">
            {getInitials(notification.actor.name)}
          </AvatarFallback>
        </Avatar>
      ) : isGithubNotification ? (
        <div
          className={cn(
            "h-9 w-9 shrink-0 rounded-full flex items-center justify-center",
            visual.iconContainerClass
          )}
        >
          {(() => {
            const FallbackIcon = FALLBACK_ICON_MAP[visual.fallbackIcon];
            return <FallbackIcon className={cn("h-4 w-4", visual.iconClass)} />;
          })()}
        </div>
      ) : (
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback className="text-xs">?</AvatarFallback>
        </Avatar>
      )}

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p
            className={cn(
              "text-sm leading-tight",
              !notification.isRead ? "font-semibold" : "font-medium"
            )}
          >
            {notification.title}
          </p>
          <Badge variant="secondary" className="shrink-0 gap-1 text-[11px]">
            <Icon className="h-3 w-3" />
            {config.label}
          </Badge>
        </div>

        {notification.body && (
          <p className="text-sm text-muted-foreground line-clamp-1">
            {notification.body}
          </p>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {notification.actor && <span>{notification.actor.name}</span>}
          <span>{timeAgo}</span>
        </div>
      </div>

      {/* Mark as read button (only for unread) */}
      {!notification.isRead && (
        <button
          className="shrink-0 mt-1 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Marcar como leida"
          onClick={(e) => {
            e.stopPropagation();
            onMarkAsRead(notification.id);
          }}
        >
          <div className="h-2 w-2 rounded-full border-2 border-current" />
        </button>
      )}
    </div>
  );
};
