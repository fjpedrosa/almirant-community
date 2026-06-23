import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import type { UtilizationMeterProps } from "../../domain/types";

const getColorClass = (percent: number, warning: number, critical: number): string => {
  if (percent >= critical) return "bg-red-500";
  if (percent >= warning) return "bg-amber-500";
  return "bg-emerald-500";
};

const getTextColorClass = (percent: number, warning: number, critical: number): string => {
  if (percent >= critical) return "text-red-500";
  if (percent >= warning) return "text-amber-500";
  return "text-emerald-500";
};

export const UtilizationMeter: React.FC<UtilizationMeterProps> = ({
  percent,
  label,
  formattedTimeLeft,
  isExpired = false,
  warningThreshold = 50,
  criticalThreshold = 80,
  expectedPercent,
  pacingLabel,
}) => {
  const barPercent = Math.min(percent, 100);
  const colorClass = getColorClass(percent, warningThreshold, criticalThreshold);
  const textColor = getTextColorClass(percent, warningThreshold, criticalThreshold);

  const hasFooter = pacingLabel || formattedTimeLeft !== undefined;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-medium tabular-nums", textColor)}>{percent.toFixed(0)}%</span>
      </div>

      {/* Progress bar with expected-percent marker */}
      <div className="relative">
        {expectedPercent !== undefined && (
          <div
            className="absolute inset-y-0 z-10 w-0.5 bg-blue-500"
            style={{ left: `${expectedPercent}%` }}
          />
        )}
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-all", colorClass)}
            style={{ width: `${barPercent}%` }}
          />
        </div>
      </div>

      {/* Footer: pacing label left, time badge right */}
      {hasFooter && (
        <div className="flex items-center justify-between text-[10px]">
          {pacingLabel ? (
            <span className="text-muted-foreground">{pacingLabel}</span>
          ) : (
            <span />
          )}
          {formattedTimeLeft !== undefined && (
            <Badge variant={isExpired ? "destructive" : "outline"} className="h-5 px-1.5 text-[10px]">
              <Clock className="mr-0.5 h-2.5 w-2.5" />
              {isExpired ? "Expired" : formattedTimeLeft}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
};
