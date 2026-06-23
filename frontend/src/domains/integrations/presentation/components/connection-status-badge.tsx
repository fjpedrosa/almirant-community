import { Badge } from "@/components/ui/badge";
import type { ConnectionStatusBadgeProps, IntegrationConnectionStatus } from "../../domain/types";

// ---------------------------------------------------------------------------
// Status badge configuration
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  IntegrationConnectionStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive"; className?: string }
> = {
  connected: {
    label: "Connected",
    variant: "default",
    className: "bg-green-600 hover:bg-green-600 text-white",
  },
  disconnected: {
    label: "Not connected",
    variant: "secondary",
  },
  inactive: {
    label: "Inactive",
    variant: "outline",
    className: "border-orange-500 text-orange-600",
  },
  suspended: {
    label: "Suspended",
    variant: "outline",
    className: "border-yellow-500 text-yellow-600",
  },
  expired: {
    label: "Expired",
    variant: "destructive",
  },
};

// ---------------------------------------------------------------------------
// ConnectionStatusBadge - Purely presentational
// ---------------------------------------------------------------------------
// Shows the connection status with the appropriate color and label.
// - connected: green badge
// - disconnected: gray/secondary badge
// - suspended: yellow outline badge
// - expired: red/destructive badge
// ---------------------------------------------------------------------------

export const ConnectionStatusBadge: React.FC<ConnectionStatusBadgeProps> = ({
  status,
}) => {
  const config = STATUS_CONFIG[status];

  return (
    <Badge
      variant={config.variant}
      className={`shrink-0 text-[11px] ${config.className ?? ""}`}
    >
      {config.label}
    </Badge>
  );
};
