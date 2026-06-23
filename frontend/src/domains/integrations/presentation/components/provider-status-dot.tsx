import { cn } from "@/lib/utils";
import type {
  ProviderStatusDotProps,
  IntegrationConnectionStatus,
} from "../../domain/types";

const STATUS_COLORS: Record<IntegrationConnectionStatus, string> = {
  connected: "bg-green-500",
  disconnected: "bg-gray-400",
  inactive: "bg-orange-500",
  suspended: "bg-yellow-500",
  expired: "bg-red-500",
};

export const ProviderStatusDot: React.FC<ProviderStatusDotProps> = ({
  status,
}) => (
  <span
    className={cn(
      "inline-block h-2 w-2 shrink-0 rounded-full",
      STATUS_COLORS[status],
    )}
    aria-label={status}
  />
);
