import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UsageTierCtaProps } from "../../domain/types";

export const UsageTierCta = ({
  totalMinutesUsed,
  tierMinuteLimit,
  tierName,
  daysRemaining,
  isLoading,
  upgradeHref = "/pricing",
}: UsageTierCtaProps) => {
  if (isLoading) {
    return (
      <Card className="bg-muted/30">
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-2 w-full" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-36" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isUnlimited = tierMinuteLimit <= 0;
  const percentage = isUnlimited
    ? 0
    : Math.min(Math.round((totalMinutesUsed / tierMinuteLimit) * 100), 100);

  return (
    <Card className="bg-muted/30">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="secondary">{tierName}</Badge>
            {isUnlimited ? (
              <span className="text-sm text-muted-foreground">
                Unlimited minutes
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                {totalMinutesUsed.toLocaleString()} /{" "}
                {tierMinuteLimit.toLocaleString()} min used
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {daysRemaining} day{daysRemaining !== 1 ? "s" : ""} remaining
          </span>
        </div>

        {!isUnlimited && (
          <div className="flex items-center gap-3">
            <Progress value={percentage} className="flex-1" />
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {percentage}%
            </span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button asChild size="sm">
            <Link href={upgradeHref}>
              Configure Limits
              <ArrowUpRight />
            </Link>
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button variant="outline" size="sm" disabled>
                    Buy Extra Minutes
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Not configured</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardContent>
    </Card>
  );
};
