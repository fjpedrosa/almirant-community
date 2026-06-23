"use client";

import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Bot, MemoryStick } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ResourceTimeline } from "@/domains/agents/domain/types";

interface SessionResourceSidebarProps {
  timeline: ResourceTimeline | null | undefined;
  isLoading?: boolean;
}

type ThresholdState = "normal" | "warning" | "critical";

const formatMemoryValue = (value: number, maximumFractionDigits = 1): string =>
  new Intl.NumberFormat(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  }).format(value);

const formatMb = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  if (value >= 1024) return `${formatMemoryValue(value / 1024)} GB`;
  return `${formatMemoryValue(Math.round(value), 0)} MB`;
};

const formatHm = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

const getRamThresholdState = (
  currentMb: number | null | undefined,
  expectedMaxMb: number | null | undefined,
): ThresholdState => {
  if (currentMb == null || expectedMaxMb == null || expectedMaxMb <= 0) {
    return "normal";
  }
  const ratio = currentMb / expectedMaxMb;
  if (ratio > 1) return "critical";
  if (ratio >= 0.8) return "warning";
  return "normal";
};

const RAM_COLOR_BY_STATE: Record<
  ThresholdState,
  { stroke: string; fill: string; text: string }
> = {
  normal: {
    stroke: "#8b5cf6",
    fill: "#8b5cf633",
    text: "text-foreground",
  },
  warning: {
    stroke: "#f59e0b",
    fill: "#f59e0b33",
    text: "text-amber-500",
  },
  critical: {
    stroke: "#ef4444",
    fill: "#ef444433",
    text: "text-red-500 dark:text-red-400",
  },
};

const confidenceVariant = (
  confidence: string | undefined,
): "default" | "secondary" | "outline" => {
  if (confidence === "high") return "default";
  if (confidence === "medium") return "secondary";
  return "outline";
};

const SidebarSection: React.FC<{
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, icon, children }) => (
  <div className="rounded-lg border bg-background/60 p-3 shadow-sm">
    <div className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      <span>{label}</span>
      {icon}
    </div>
    <div className="mt-2">{children}</div>
  </div>
);

const StatRow: React.FC<{ label: string; value: React.ReactNode }> = ({
  label,
  value,
}) => (
  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
    <span>{label}</span>
    <span className="font-medium tabular-nums text-foreground">{value}</span>
  </div>
);

export const SessionResourceSidebar: React.FC<SessionResourceSidebarProps> = ({
  timeline,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!timeline) {
    return (
      <div className="rounded-lg border border-dashed bg-background/40 p-3 text-xs text-muted-foreground">
        No RAM samples for this job yet.
      </div>
    );
  }

  const samples = timeline.samples;
  const latestSample = samples.at(-1);
  const currentRamMb = latestSample?.ramUsedMb ?? null;
  const currentAgents = latestSample?.activeSubagents ?? 0;
  const expectedRamMb =
    timeline.summary.forecastMemoryMb ??
    timeline.forecast?.estimatedMemoryMb ??
    null;
  const expectedRamGb = expectedRamMb != null ? expectedRamMb / 1024 : null;

  const thresholdState = getRamThresholdState(currentRamMb, expectedRamMb);
  const ramColors = RAM_COLOR_BY_STATE[thresholdState];

  const chartData = samples.map((sample) => ({
    time: formatHm(sample.timestamp),
    ramGb: Number((sample.ramUsedMb / 1024).toFixed(2)),
    activeSubagents: sample.activeSubagents,
  }));
  const firstTick = chartData[0]?.time;
  const lastTick = chartData[chartData.length - 1]?.time;
  const axisTicks =
    firstTick && lastTick && firstTick !== lastTick
      ? [firstTick, lastTick]
      : firstTick
        ? [firstTick]
        : [];

  const currentRamPerAgent =
    latestSample && currentAgents > 0
      ? formatMb(latestSample.ramUsedMb / currentAgents)
      : "—";

  return (
    <div className="flex flex-col gap-3">
      {timeline.forecast && (
        <div className="flex items-center justify-end">
          <Badge
            variant={confidenceVariant(timeline.forecast.confidence)}
            className="text-[10px]"
          >
            {timeline.forecast.confidence} confidence
          </Badge>
        </div>
      )}

      <SidebarSection label="RAM" icon={<MemoryStick className="h-3 w-3" />}>
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 tabular-nums">
          <span
            className={cn(
              "text-2xl font-semibold leading-none",
              ramColors.text,
            )}
          >
            {formatMb(currentRamMb)}
          </span>
          {expectedRamMb !== null && (
            <span className="text-xs font-medium text-muted-foreground">
              / {formatMb(expectedRamMb)}
            </span>
          )}
        </div>
        {expectedRamMb !== null && (
          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            expected max
          </p>
        )}
        <div className="mt-3 grid gap-1">
          <StatRow label="max" value={formatMb(timeline.summary.peakRamMb)} />
          <StatRow
            label="avg"
            value={formatMb(timeline.summary.averageRamMb)}
          />
          {timeline.summary.forecastDeltaMb !== null && (
            <StatRow
              label="delta"
              value={formatMb(timeline.summary.forecastDeltaMb)}
            />
          )}
        </div>
      </SidebarSection>

      <SidebarSection label="Subagents" icon={<Bot className="h-3 w-3" />}>
        <div className="text-2xl font-semibold leading-none tabular-nums text-foreground">
          {currentAgents}
        </div>
        <div className="mt-3 grid gap-1">
          <StatRow label="RAM/agent" value={currentRamPerAgent} />
          <StatRow label="max" value={timeline.summary.maxSubagents} />
        </div>
      </SidebarSection>

      {samples.length > 0 && (
        <SidebarSection
          label="RAM trend"
          icon={<MemoryStick className="h-3 w-3" />}
        >
          <div className="h-28 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              >
                <YAxis yAxisId="ram" hide />
                <YAxis
                  yAxisId="agents"
                  orientation="right"
                  hide
                  allowDecimals={false}
                />
                <XAxis
                  dataKey="time"
                  ticks={axisTicks}
                  interval={0}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  height={16}
                />
                <Tooltip
                  cursor={{
                    stroke: "hsl(var(--muted-foreground))",
                    strokeDasharray: "4 4",
                    strokeOpacity: 0.4,
                  }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const ramItem = payload.find(
                      (p) => p.dataKey === "ramGb",
                    );
                    const agentsItem = payload.find(
                      (p) => p.dataKey === "activeSubagents",
                    );
                    return (
                      <div className="space-y-0.5 rounded-md border bg-popover px-2 py-1 text-[11px] tabular-nums shadow-md">
                        {ramItem && (
                          <div>
                            <span className="text-muted-foreground">RAM </span>
                            <span className="font-medium text-foreground">
                              {ramItem.value} GB
                            </span>
                          </div>
                        )}
                        {agentsItem && (
                          <div>
                            <span className="text-muted-foreground">
                              Agents{" "}
                            </span>
                            <span className="font-medium text-foreground">
                              {agentsItem.value}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                {expectedRamGb !== null && (
                  <ReferenceLine
                    yAxisId="ram"
                    y={expectedRamGb}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                    strokeWidth={1.25}
                    ifOverflow="extendDomain"
                  />
                )}
                <Area
                  yAxisId="ram"
                  type="monotone"
                  dataKey="ramGb"
                  stroke={ramColors.stroke}
                  fill={ramColors.fill}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="agents"
                  type="stepAfter"
                  dataKey="activeSubagents"
                  stroke="#06b6d4"
                  strokeWidth={1.25}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </SidebarSection>
      )}
    </div>
  );
};
