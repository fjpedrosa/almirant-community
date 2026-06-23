export const sessionKeys = {
  all: ["sessions"] as const,
  lists: () => [...sessionKeys.all, "list"] as const,
  list: (filters: string) => [...sessionKeys.lists(), filters] as const,
  details: () => [...sessionKeys.all, "detail"] as const,
  detail: (id: string) => [...sessionKeys.details(), id] as const,
  output: (id: string) => [...sessionKeys.all, "output", id] as const,
  sessionEvents: (id: string) => [...sessionKeys.all, "session-events", id] as const,
  workItem: (workItemId: string) =>
    [...sessionKeys.all, "work-item", workItemId] as const,
  interactions: (jobId: string) =>
    [...sessionKeys.all, "interactions", jobId] as const,
};
