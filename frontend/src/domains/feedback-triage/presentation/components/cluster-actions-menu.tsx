"use client";

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  MoreVertical,
  RotateCcw,
  Search,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getAvailableActions,
  getMaintenanceActions,
  type ClusterActionKind,
  type ClusterRow,
} from "@/domains/feedback-triage/domain/types";
import { cn } from "@/lib/utils";

// Usage example:
//
//   <ClusterActionsMenu
//     cluster={row}
//     onTransition={(action) => dispatchTransition(row.id, action)}
//     isPending={mutation.isPending}
//   />

export interface ClusterActionsMenuProps {
  cluster: ClusterRow;
  onTransition: (action: ClusterActionKind) => void;
  isPending?: boolean;
}

interface ActionDescriptor {
  label: string;
  icon: LucideIcon;
}

const ACTION_DESCRIPTORS: Record<ClusterActionKind, ActionDescriptor> = {
  investigate: { label: "Investigar", icon: Search },
  mark_fix_ready: { label: "Marcar como fix listo", icon: Wrench },
  resolve: { label: "Resolver", icon: CheckCircle2 },
  reopen: { label: "Reabrir", icon: RotateCcw },
  mark_regression: { label: "Marcar regresión", icon: AlertTriangle },
  dismiss: { label: "Descartar", icon: XCircle },
  abort: { label: "Abortar y resetear", icon: Ban },
};

export const ClusterActionsMenu = ({
  cluster,
  onTransition,
  isPending = false,
}: ClusterActionsMenuProps) => {
  const actions = getAvailableActions(cluster.status);
  const maintenanceActions = getMaintenanceActions(cluster);
  const hasActions = actions.length > 0 || maintenanceActions.length > 0;
  const triggerLabel = `Acciones del cluster ${cluster.title}`;

  if (!hasActions) {
    return (
      <Button
        variant="ghost"
        size="icon"
        disabled
        aria-label={triggerLabel}
        title="Sin transiciones disponibles"
      >
        <MoreVertical />
      </Button>
    );
  }

  const renderActionItem = (action: ClusterActionKind, destructive = false) => {
    const descriptor = ACTION_DESCRIPTORS[action];
    const Icon = descriptor.icon;
    return (
      <DropdownMenuItem
        key={action}
        disabled={isPending}
        onClick={() => onTransition(action)}
        className={cn(
          destructive &&
            "text-destructive focus:text-destructive focus:bg-destructive/10"
        )}
      >
        <Icon />
        <span>{descriptor.label}</span>
      </DropdownMenuItem>
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={triggerLabel}
        >
          <MoreVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.length > 0 && (
          <>
            <DropdownMenuLabel>Transiciones</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {actions.map((action) => renderActionItem(action))}
          </>
        )}
        {maintenanceActions.length > 0 && (
          <>
            {actions.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>Mantenimiento</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {maintenanceActions.map((action) => renderActionItem(action, true))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
