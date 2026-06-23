import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NotificationFilterBarProps, NotificationType } from "../../domain/types";

const TYPE_OPTIONS: { value: NotificationType; label: string }[] = [
  { value: "assignment", label: "Asignaciones" },
  { value: "comment", label: "Comentarios" },
  { value: "mention", label: "Menciones" },
  { value: "status_changed", label: "Cambios de estado" },
];

export const NotificationFilterBar: React.FC<NotificationFilterBarProps> = ({
  filters,
  onTypeChange,
  onReadFilterChange,
  onMarkAllAsRead,
}) => {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={filters.type || "all"}
        onValueChange={(value) =>
          onTypeChange(value === "all" ? undefined : (value as NotificationType))
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Tipo" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los tipos</SelectItem>
          {TYPE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.isRead === undefined ? "all" : filters.isRead ? "read" : "unread"}
        onValueChange={(value) =>
          onReadFilterChange(value === "all" ? undefined : value === "read")
        }
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Estado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas</SelectItem>
          <SelectItem value="unread">No leidas</SelectItem>
          <SelectItem value="read">Leidas</SelectItem>
        </SelectContent>
      </Select>

      <Button variant="outline" size="sm" onClick={onMarkAllAsRead}>
        <CheckCheck className="mr-2 h-4 w-4" />
        Marcar todas como leidas
      </Button>
    </div>
  );
};
