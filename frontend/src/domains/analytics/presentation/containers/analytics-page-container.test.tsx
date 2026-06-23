import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

(
  globalThis as typeof globalThis & {
    requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  }
).requestAnimationFrame = (callback) => {
  callback(0);
  return 0;
};

(
  globalThis as typeof globalThis & {
    cancelAnimationFrame?: (handle: number) => void;
  }
).cancelAnimationFrame = () => undefined;

const cancelJob = mock(() => undefined);

const createAnalyticsPageState = () => ({
  overview: {
    totalAiSessions: 42,
    activeUsers: 3,
    activeProjects: 2,
    totalBoards: 4,
    workItemsCreated: 12,
    workItemsCompleted: 8,
    currentMonthUsage: {
      totalSeconds: 3600,
      totalJobs: 7,
      breakdown: {
        implement: 1200,
        validate: 600,
        planning: 900,
        review: 300,
        chat: 600,
      },
    },
  },
  trends: [
    {
      period: "2026-03",
      totalSeconds: 1800,
      totalJobs: 3,
      breakdown: { implement: 0, validate: 0, planning: 0, review: 0, chat: 0 },
    },
    {
      period: "2026-04",
      totalSeconds: 3600,
      totalJobs: 7,
      breakdown: { implement: 0, validate: 0, planning: 0, review: 0, chat: 0 },
    },
  ],
  users: [
    {
      userId: "u1",
      userName: "Ada Lovelace",
      userEmail: "ada@example.com",
      period: "2026-04",
      totalSeconds: 2400,
      billableSeconds: 2400,
      totalJobs: 4,
      breakdown: { implement: 0, validate: 0, planning: 0, review: 0, chat: 0 },
    },
  ],
  systemMonitoring: {
    range: "1h",
    generatedAt: "2026-04-29T12:00:00.000Z",
    workers: [
      {
        workerId: "worker-1",
        hostname: "m1pro",
        currentIp: null,
        status: "online",
        activeJobs: 1,
        maxConcurrentAgents: 2,
        isDraining: false,
        availableSlots: 1,
        ramBudgetMb: 8192,
        ramCommittedMb: 2048,
        ramAvailableMb: 4096,
        lastHeartbeatAt: "2026-04-29T12:00:00.000Z",
        activeJobDetails: [
          {
            id: "job-1",
            jobType: "implementation",
            status: "running",
            workItemId: "work-item-1",
            workItemTaskId: "A-1",
            workItemTitle: "Fix mobile sessions",
            createdAt: "2026-04-29T11:45:00.000Z",
            startedAt: "2026-04-29T11:46:00.000Z",
            config: { skillName: "runner-implement", resourceEstimate: { estimatedMemoryMb: 3584, source: "forecast", confidence: "low" } },
            promptTemplate: "runner-implement",
            skillName: "runner-implement",
          },
        ],
        systemMetrics: {
          cpuPercent: 12.5,
          ramPercent: 44.1,
          ramTotalMb: 16384,
          ramUsedMb: 7225,
          ramSystemAvailableMb: 8192,
          ramReservedMb: 2048,
          ramAvailableForRunnersMb: 4096,
          containerMetrics: [
            {
              jobId: "job-1",
              jobType: "implementation",
              containerId: "container-1",
              cpuPercent: 2.5,
              memoryUsageMb: 2048,
              memoryLimitMb: 4096,
            },
          ],
          processes: [{ jobId: "job-1", skillName: "runner-implement" }],
        },
      },
    ],
    metricsHistory: [],
  },
  isLoading: false,
  isSystemMonitoringLoading: false,
  error: null,
  systemMonitoringError: null,
  cancelJob,
  isCancellingJob: false,
});

let analyticsPageState = createAnalyticsPageState();

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      title: "Analytics",
      description: "Organization usage metrics and per-user consumption.",
      "kpi.totalMinutes": "Total Minutes",
      "kpi.totalSessions": "Total Sessions",
      "kpi.activeUsers": "Active Users",
      "kpi.activeProjects": "Active Projects",
      "charts.monthlyTrend": "Monthly Usage Trend",
      "charts.topUsers": "Top 5 Users",
      "table.noData": "No usage data found for this period.",
      "table.unknown": "Unknown",
      "table.minutes": "Minutes",
      "yAxis.minutes": "Minutes",
      "tabs.usage": "Usage",
      "tabs.system": "System & Processes",
      "system.kpi.onlineWorkers": "Runners online",
      "system.kpi.avgCpu": "Average CPU",
      "system.kpi.activeJobs": "Active jobs",
      "system.kpi.cpuPerJob": "CPU / active job",
      "system.kpi.measuredJobs": "measured jobs",
      "system.kpi.ram": "RAM used",
      "system.kpi.processes": "Active processes",
      "system.workers": "System monitoring",
      "system.processTable": "Processes and containers",
      "system.freeSlots": "free slots",
      "system.processes": "processes",
      "system.capacity": "capacity",
      "system.cpuHeadroom": "CPU-only headroom",
      "system.estimatedCpuSlots": "CPU-only extra slots",
      "system.memory.systemAvailable": "System available",
      "system.memory.reserved": "Reserved for system",
      "system.memory.runnerAvailable": "Available for runners",
      "system.memory.committed": "Committed by jobs",
      "system.memory.budget": "Runner budget",
      "system.memory.jobForecast": "Forecast",
      "system.updatedAt": "Updated at",
      "system.noWorkers": "No workers are sending heartbeats yet.",
      "system.noProcesses": "No active processes or containers right now.",
      "system.error": "Unable to load system monitoring data.",
      "system.cancelJob": "Cancel job",
      "system.cancelJobTitle": "Cancel active job",
      "system.cancelJobDescription": "This marks the job as cancelled.",
      "system.cancelSuccess": "Job cancelled",
      "system.cancelError": "Unable to cancel job",
    };
    return labels[key] ?? key;
  },
}));

mock.module("../../application/hooks/use-analytics-page", () => ({
  useAnalyticsPage: () => analyticsPageState,
}));

describe("AnalyticsPageContainer", () => {
  beforeEach(() => {
    analyticsPageState = createAnalyticsPageState();
    cancelJob.mockClear();
  });

  it("renders KPI data from the analytics API shape", async () => {
    const { AnalyticsPageContainer } =
      await import("./analytics-page-container");

    render(<AnalyticsPageContainer />);

    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("renders system monitoring data in the system tab", async () => {
    const { AnalyticsPageContainer } =
      await import("./analytics-page-container");

    render(<AnalyticsPageContainer />);
    fireEvent.click(screen.getByRole("tab", { name: "System & Processes" }));

    expect(screen.getByText("System monitoring")).toBeInTheDocument();
    expect(screen.getByText("Active jobs")).toBeInTheDocument();
    expect(screen.getAllByText("1/2").length).toBeGreaterThan(0);
    expect(screen.getByText("CPU / active job")).toBeInTheDocument();
    expect(screen.getAllByText("CPU-only headroom: 57.5%").length).toBeGreaterThan(0);
    expect(screen.getByText("CPU-only extra slots: +23")).toBeInTheDocument();
    expect(screen.getAllByText("m1pro").length).toBeGreaterThan(0);
    expect(screen.getByText("runner-implement")).toBeInTheDocument();
    expect(screen.getByText("A-1 · Fix mobile sessions")).toBeInTheDocument();
    expect(screen.getAllByText("7.1 GB / 16 GB").length).toBeGreaterThan(0);
    expect(screen.getByText("System available")).toBeInTheDocument();
    expect(screen.getByText("Available for runners")).toBeInTheDocument();
    expect(screen.getByText("Committed by jobs")).toBeInTheDocument();
    expect(screen.getByText("Forecast: 3.5 GB")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel job" }),
    ).toBeInTheDocument();
  });

  it("does not render stale container metrics without an active job detail", async () => {
    analyticsPageState.systemMonitoring.workers[0]!.activeJobs = 0;
    analyticsPageState.systemMonitoring.workers[0]!.activeJobDetails = [];
    analyticsPageState.systemMonitoring.workers[0]!.systemMetrics!.containerMetrics = [
      {
        jobId: "stale-job",
        jobType: "implementation",
        containerId: "stale-container",
        cpuPercent: 0,
        memoryUsageMb: 512,
        memoryLimitMb: 2048,
      },
    ];

    const { AnalyticsPageContainer } =
      await import("./analytics-page-container");

    render(<AnalyticsPageContainer />);
    fireEvent.click(screen.getByRole("tab", { name: "System & Processes" }));

    expect(screen.queryByText("Job stale-job")).not.toBeInTheDocument();
    expect(screen.queryByText(/stale-container/)).not.toBeInTheDocument();
    expect(
      screen.getByText("No active processes or containers right now."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel job" }),
    ).not.toBeInTheDocument();
  });
});
