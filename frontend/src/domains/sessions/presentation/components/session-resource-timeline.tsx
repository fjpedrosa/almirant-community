"use client";

import { useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Bot, ChevronDown, ChevronUp, MemoryStick } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ResourceTimeline } from "@/domains/agents/domain/types";

interface SessionResourceTimelineProps {
  timeline: ResourceTimeline | null | undefined;
  isLoading?: boolean;
}

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

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const confidenceVariant = (
  confidence: string | undefined,
): "default" | "secondary" | "outline" => {
  if (confidence === "high") return "default";
  if (confidence === "medium") return "secondary";
  return "outline";
};

const MetricGroupCard: React.FC<{
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, icon, children }) => (
  <div className="rounded-xl border bg-background/60 p-4 shadow-sm">
    <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      <span>{label}</span>
      {icon}
    </div>
    <div className="mt-3">{children}</div>
  </div>
);

export const SessionResourceTimeline: React.FC<
  SessionResourceTimelineProps
> = ({ timeline, isLoading }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  if (isLoading) {
    return (
      <Card className="mx-4 mt-4">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-44" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!timeline) {
    return (
      <Card className="mx-4 mt-4 border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <MemoryStick className="h-4 w-4" />
            Resource timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No RAM samples are available for this job yet. Worker metrics or
            container metrics may not have been reported.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (timeline.samples.length === 0) {
    const forecastMemoryMb =
      timeline.summary.forecastMemoryMb ?? timeline.forecast?.estimatedMemoryMb ?? null;

    return (
      <Card className="mx-4 mt-4 border-dashed">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MemoryStick className="h-4 w-4" />
              Resource timeline
            </CardTitle>
            {timeline.forecast && (
              <Badge variant={confidenceVariant(timeline.forecast.confidence)}>
                {timeline.forecast.confidence} confidence
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {forecastMemoryMb !== null && (
            <MetricGroupCard
              label="RAM"
              icon={<MemoryStick className="h-3.5 w-3.5" />}
            >
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 tabular-nums">
                <span className="text-2xl font-semibold leading-none text-muted-foreground">
                  —
                </span>
                <span className="text-sm font-medium text-muted-foreground">
                  / {formatMb(forecastMemoryMb)}{" "}
                  <span className="text-[11px] uppercase tracking-wide">
                    expected max
                  </span>
                </span>
              </div>
              {timeline.forecast?.reason && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {timeline.forecast.reason}
                </p>
              )}
            </MetricGroupCard>
          )}
          <p className="text-sm text-muted-foreground">
            No RAM samples are available for this job yet. Worker metrics or
            container metrics may not have been reported.
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartData = timeline.samples.map((sample) => ({
    time: formatTime(sample.timestamp),
    ramGb: Number((sample.ramUsedMb / 1024).toFixed(2)),
    activeSubagents: sample.activeSubagents,
    activeWave: sample.activeWave,
  }));
  const latestSample = timeline.samples.at(-1);
  const currentRam = latestSample ? formatMb(latestSample.ramUsedMb) : "—";
  const currentAgents = latestSample?.activeSubagents ?? 0;
  const currentRamPerAgent =
    latestSample && currentAgents > 0
      ? formatMb(latestSample.ramUsedMb / currentAgents)
      : "—";
  const expectedRamMb =
    timeline.summary.forecastMemoryMb ?? timeline.forecast?.estimatedMemoryMb ?? null;
  const expectedRam = formatMb(expectedRamMb);

  return (
    <Card className="mx-4 mt-4">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MemoryStick className="h-4 w-4" />
              Resource timeline
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="gap-1.5 tabular-nums">
                <MemoryStick className="h-3 w-3" />
                RAM {currentRam}
                {expectedRamMb !== null ? ` / ${expectedRam}` : ""}
              </Badge>
              <Badge variant="outline" className="gap-1.5 tabular-nums">
                <Bot className="h-3 w-3" />
                Agents now {currentAgents}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {timeline.forecast && (
              <Badge variant={confidenceVariant(timeline.forecast.confidence)}>
                {timeline.forecast.confidence} confidence
              </Badge>
            )}
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={isExpanded}
              aria-label={
                isExpanded
                  ? "Collapse resource timeline"
                  : "Expand resource timeline"
              }
              onClick={() => setIsExpanded((current) => !current)}
            >
              {isExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {isExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-3">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="h-44 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 8, right: 18, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    className="stroke-muted"
                  />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="ram"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    unit="GB"
                  />
                  <YAxis
                    yAxisId="agents"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "0.75rem",
                      boxShadow:
                        "0 18px 45px -24px rgb(15 23 42 / 0.35), 0 8px 16px -12px rgb(15 23 42 / 0.25)",
                      color: "hsl(var(--popover-foreground))",
                    }}
                    cursor={{
                      stroke: "hsl(var(--muted-foreground))",
                      strokeDasharray: "4 4",
                      strokeOpacity: 0.45,
                    }}
                    itemStyle={{
                      color: "hsl(var(--foreground))",
                      fontSize: 12,
                    }}
                    labelStyle={{
                      color: "hsl(var(--foreground))",
                      fontSize: 12,
                      fontWeight: 700,
                      marginBottom: 4,
                    }}
                    formatter={(value, name) => {
                      if (name === "activeSubagents")
                        return [value, "Active subagents"];
                      return [`${value} GB`, "RAM"];
                    }}
                    labelFormatter={(label) => `Time ${label}`}
                  />
                  <Area
                    yAxisId="ram"
                    type="monotone"
                    dataKey="ramGb"
                    name="ramGb"
                    stroke="#8b5cf6"
                    fill="#8b5cf633"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="agents"
                    type="stepAfter"
                    dataKey="activeSubagents"
                    name="activeSubagents"
                    stroke="#06b6d4"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <MetricGroupCard
                label="RAM"
                icon={<MemoryStick className="h-3.5 w-3.5" />}
              >
                <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 tabular-nums">
                  <span className="text-2xl font-semibold leading-none text-foreground">
                    {currentRam}
                  </span>
                  {expectedRamMb !== null && (
                    <span className="text-sm font-medium text-muted-foreground">
                      / {expectedRam}{" "}
                      <span className="text-[11px] uppercase tracking-wide">
                        expected max
                      </span>
                    </span>
                  )}
                </div>
                <div className="mt-3 grid gap-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>max</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {formatMb(timeline.summary.peakRamMb)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>avg</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {formatMb(timeline.summary.averageRamMb)}
                    </span>
                  </div>
                  {expectedRamMb !== null && (
                    <div className="flex items-center justify-between gap-3">
                      <span>expected max</span>
                      <span className="font-medium tabular-nums text-foreground">
                        {expectedRam}
                      </span>
                    </div>
                  )}
                  {timeline.summary.forecastDeltaMb !== null && (
                    <div className="flex items-center justify-between gap-3">
                      <span>delta</span>
                      <span className="font-medium tabular-nums text-foreground">
                        {formatMb(timeline.summary.forecastDeltaMb)}
                      </span>
                    </div>
                  )}
                </div>
              </MetricGroupCard>

              <MetricGroupCard
                label="Subagents"
                icon={<Bot className="h-3.5 w-3.5" />}
              >
                <div className="text-2xl font-semibold leading-none tabular-nums text-foreground">
                  {currentAgents}
                </div>
                <div className="mt-3 grid gap-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>RAM per agent</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {currentRamPerAgent}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span>max</span>
                    <span className="font-medium tabular-nums text-foreground">
                      {timeline.summary.maxSubagents}
                    </span>
                  </div>
                </div>
              </MetricGroupCard>
            </div>
          </div>

          {timeline.agents.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {timeline.agents.slice(0, 12).map((agent) => (
                <Badge
                  key={agent.subagentId}
                  variant="outline"
                  className="gap-1"
                >
                  <Bot className="h-3 w-3" />
                  {agent.subagentType}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
};
