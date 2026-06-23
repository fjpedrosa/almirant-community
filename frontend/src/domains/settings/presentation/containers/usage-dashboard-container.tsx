"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  useUsageSummary,
  useUsageHistory,
  useUsageProjectSummaries,
} from "../../application/hooks/use-usage-data";
import {
  useUsageDailyHistory,
  useUsageHourlyDistribution,
} from "../../application/hooks/use-usage-daily-data";
import { useProjects } from "@/domains/projects/application/hooks/use-projects";
import { UsageStatsCards } from "../components/usage-stats-cards";
import { UsageHistoryChart } from "../components/usage-history-chart";
import { UsageProjectBreakdown } from "../components/usage-project-breakdown";
import { UsageQuotaProgress } from "../components/usage-quota-progress";
import { UsageSessionDonut } from "../components/usage-session-donut";
import { UsageHourlyDistribution } from "../components/usage-hourly-distribution";
import { XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SettingsPageShell } from "../components/settings-page-shell";
import type { UsageTimeRange } from "../../domain/types";

const RANGE_OPTIONS: { value: UsageTimeRange; labelKey: string }[] = [
  { value: "7d", labelKey: "ranges.sevenDays" },
  { value: "30d", labelKey: "ranges.thirtyDays" },
  { value: "90d", labelKey: "ranges.ninetyDays" },
  { value: "12m", labelKey: "ranges.twelveMonths" },
];

const rangeToDays = (range: UsageTimeRange): number => {
  switch (range) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    default:
      return 30;
  }
};

export const UsageDashboardContainer = () => {
  const t = useTranslations("usage");
  const [usageRange, setUsageRange] = useState<UsageTimeRange>("30d");

  const { data: summary, isLoading: isLoadingSummary, error: summaryError } = useUsageSummary();
  const { data: history, isLoading: isLoadingHistory, error: historyError } = useUsageHistory(12);
  const { data: projects } = useProjects();
  const {
    items: projectBreakdownItems,
    error: projectBreakdownError,
  } = useUsageProjectSummaries(projects ?? []);

  const isDailyRange = usageRange !== "12m";
  const selectedDays = rangeToDays(usageRange);
  const {
    data: dailyData,
    isLoading: isLoadingDaily,
    error: dailyError,
  } = useUsageDailyHistory(selectedDays);
  const {
    data: hourlyData,
    isLoading: isLoadingHourly,
    error: hourlyError,
  } = useUsageHourlyDistribution(30);

  const timelineHistory = isDailyRange
    ? (dailyData ?? []).map((entry) => ({
        period: entry.date,
        totalSeconds: entry.totalSeconds,
        totalJobs: entry.totalJobs,
        breakdown: entry.breakdown,
      }))
    : (history ?? []);

  const isLoadingTimeline = isDailyRange ? isLoadingDaily : isLoadingHistory;
  const timelineTitle = isDailyRange
    ? t("timeline.dailyTitle")
    : t("timeline.monthlyTitle");
  const timelineDescription = isDailyRange
    ? t("timeline.dailyDescription")
    : t("timeline.monthlyDescription");

  const error = summaryError || historyError || projectBreakdownError || dailyError || hourlyError;

  if (error) {
    return (
      <SettingsPageShell title={t("title")} description={t("subtitle")}>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <XCircle className="h-8 w-8 text-destructive mb-2" />
            <p className="text-sm text-muted-foreground">{t("errorLoading")}</p>
          </CardContent>
        </Card>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title={t("title")} description={t("subtitle")}>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">{t("serverStats")}</h3>
          <p className="text-xs text-muted-foreground">{t("serverStatsDescription")}</p>
        </div>
        <UsageStatsCards
          totalSeconds={summary?.totalSeconds ?? 0}
          totalJobs={summary?.totalJobs ?? 0}
          breakdown={summary?.breakdown ?? {}}
          isLoading={isLoadingSummary}
          totalTimeLabel={t("totalTime")}
          totalJobsLabel={t("totalJobs")}
          mostActiveLabel={t("mostActiveType")}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.9fr)]">
        <Card>
          <CardContent className="p-4">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-sm font-medium">{timelineTitle}</h3>
                <p className="text-xs text-muted-foreground">{timelineDescription}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {RANGE_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    variant={usageRange === option.value ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setUsageRange(option.value)}
                  >
                    {t(option.labelKey)}
                  </Button>
                ))}
              </div>
            </div>
            <UsageHistoryChart
              history={timelineHistory}
              isLoading={isLoadingTimeline}
              noDataMessage={t("noHistoryData")}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="mb-4">
              <h3 className="text-sm font-medium">{t("hourlyDistribution")}</h3>
              <p className="text-xs text-muted-foreground">{t("hourlyDistributionDescription")}</p>
            </div>
            <UsageHourlyDistribution
              data={hourlyData ?? []}
              isLoading={isLoadingHourly}
              noDataMessage={t("noData")}
              sessionsLabel={t("hourly.sessionsLabel")}
              peakLabel={t("hourly.peakLabel")}
              minutesLabel={t("hourly.minutesLabel")}
            />
          </CardContent>
        </Card>
      </div>

      {(summary?.quotas?.length ?? 0) > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-4 text-sm font-medium">{t("quotaUsage")}</h3>
            <UsageQuotaProgress quotas={summary?.quotas ?? []} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-4 text-sm font-medium">{t("sessionDistribution")}</h3>
            <UsageSessionDonut
              breakdown={summary?.breakdown ?? {}}
              isLoading={isLoadingSummary}
            />
          </CardContent>
        </Card>

        {projects && projects.length > 1 && (
          <Card>
            <CardContent className="p-4">
              <h3 className="mb-4 text-sm font-medium">{t("breakdownByProject")}</h3>
              <UsageProjectBreakdown items={projectBreakdownItems} />
            </CardContent>
          </Card>
        )}
      </div>
    </SettingsPageShell>
  );
};
