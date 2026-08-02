import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export interface KpiCardProps {
  label: string;
  value: string;
  icon: ReactNode;
  unit?: string;
  description?: string;
  isLoading?: boolean;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  icon,
  unit,
  description,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <Card className="gap-0 py-3">
        <CardContent className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-md" />
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-3 w-16" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-0 py-3" aria-label={`${label}: ${value}${unit ? ` ${unit}` : ""}`}>
      <CardContent className="flex items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-lg font-bold tabular-nums">
            {value}
            {unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
          </p>
          <p className="text-xs text-muted-foreground">{label}</p>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground/70">{description}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
