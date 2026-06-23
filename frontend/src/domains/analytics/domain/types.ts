export type AnalyticsSystemMetrics = {
  cpuPercent: number;
  cpuCores?: number;
  ramPercent: number;
  ramTotalMb: number;
  ramUsedMb: number;
  ramSystemAvailableMb?: number;
  ramReservedMb?: number;
  ramAvailableForRunnersMb?: number;
  ramPressurePercent?: number;
  ramBudgetEnabled?: boolean;
  memorySource?: "proc-meminfo" | "os";
  processes: Array<{ jobId: string; skillName: string }>;
  containerMetrics?: AnalyticsContainerMetric[];
};

export type AnalyticsContainerMetric = {
  containerId: string;
  jobId: string;
  jobType: string;
  createdAt?: string | null;
  cpuPercent: number;
  memoryUsageMb: number;
  memoryLimitMb: number;
  memoryPercent: number;
};

export type AnalyticsWorkerJob = {
  id: string;
  jobType: string;
  status: string;
  workItemId: string | null;
  workItemTaskId?: string | null;
  workItemTitle?: string | null;
  createdAt: string;
  startedAt: string | null;
  config: Record<string, unknown> | null;
  promptTemplate?: string | null;
  skillName?: string | null;
};

export type AnalyticsWorker = {
  workerId: string;
  hostname: string;
  currentIp: string | null;
  status: "online" | "offline";
  activeJobs: number;
  maxConcurrentAgents: number;
  isDraining: boolean;
  availableSlots: number;
  ramBudgetMb: number | null;
  ramCommittedMb: number | null;
  ramAvailableMb: number | null;
  systemMetrics: AnalyticsSystemMetrics | null;
  lastHeartbeatAt: string | null;
  activeJobDetails: AnalyticsWorkerJob[];
};

export type AnalyticsWorkerMetricSnapshot = {
  id: string;
  workerId: string;
  timestamp: string;
  cpuPercent: string | number | null;
  ramPercent: string | number | null;
  ramUsedMb: number | null;
  ramTotalMb: number | null;
  activeJobs: number | null;
  containerMetrics: AnalyticsContainerMetric[] | null;
  createdAt: string;
};

export type AnalyticsSystemMonitoringResponse = {
  range: "1h" | "6h" | "24h";
  generatedAt: string;
  workers: AnalyticsWorker[];
  metricsHistory: AnalyticsWorkerMetricSnapshot[];
};
