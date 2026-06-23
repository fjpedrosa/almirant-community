"use client";

import { X, ArrowRight, CheckCircle, Loader2,
  Trash2,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { StatusOption } from "./status-expanding-pill";

export interface ListSelectionActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  // Status change action
  statusOptions?: StatusOption[];
  onStatusChange?: (status: string) => void;
  isStatusChanging?: boolean;
  // Owner change action
  members?: Array<{
    id: string;
    name: string;
    email: string;
    image?: string | null;
  }>;
  currentOwnerId?: string | null;
  onOwnerChange?: (userId: string) => void;
  isOwnerChanging?: boolean;
  // Delete action
  onDelete?: () => void;
  isDeleting?: boolean;
  deleteLabel?: string;
  // Extra domain-specific actions (rendered after the built-in actions)
  children?: React.ReactNode;
}

export const ListSelectionActionBar: React.FC<ListSelectionActionBarProps> = ({
  selectedCount,
  onClearSelection,
  statusOptions,
  onStatusChange,
  isStatusChanging,
  members,
  currentOwnerId,
  onOwnerChange,
  isOwnerChanging,
  onDelete,
  isDeleting,
  deleteLabel = "Eliminar",
  children,
}) => {
  const t = useTranslations("shared.bulkActions");

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 md:gap-3 bg-card border rounded-lg shadow-lg px-3 md:px-4 py-2 md:py-2.5">
      <span className="text-sm font-medium">
        {t("selected", { count: selectedCount })}
      </span>

      {/* Status change dropdown */}
      {statusOptions && statusOptions.length > 0 && onStatusChange && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={isStatusChanging}>
              <ArrowRight className="h-4 w-4 mr-1.5" />
              {isStatusChanging ? t("changingStatus") : t("changeStatus")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {statusOptions.map((status) => {
              const Icon = status.icon;
              return (
                <DropdownMenuItem
                  key={status.value}
                  onClick={() => onStatusChange(status.value)}
                >
                  {Icon && (
                    <status.icon
                      className={`h-4 w-4 mr-1.5 ${status.color}`}
                    />
                  )}
                  {status.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Owner change dropdown */}
      {members && members.length > 0 && onOwnerChange && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={isOwnerChanging}>
              <User className="h-4 w-4 mr-1.5" />
              {isOwnerChanging ? t("changingOwner") : t("assignOwner")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center">
            {members.map((member) => (
              <DropdownMenuItem
                key={member.id}
                onClick={() => onOwnerChange(member.id)}
              >
                <div className="flex items-center gap-2">
                  <Avatar className="h-5 w-5">
                    {member.image && (
                      <AvatarImage src={member.image} alt={member.name} />
                    )}
                    <AvatarFallback className="text-xs">
                      {member.name.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{member.name}</span>
                </div>
              </DropdownMenuItem>
            ))}
            {currentOwnerId && (
              <DropdownMenuItem
                onClick={() => onOwnerChange("")}
                className="text-muted-foreground"
              >
                <CheckCircle className="h-4 w-4 mr-1.5" />
                {t("clearOwner")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Delete button */}
      {onDelete && (
        <Button
          size="sm"
          variant="outline"
          disabled={isDeleting}
          className="text-destructive hover:text-destructive"
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 mr-1.5" />
          )}
          {deleteLabel}
        </Button>
      )}

      {children}

      {/* Clear selection button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onClearSelection}
        aria-label={t("clearSelection")}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};
