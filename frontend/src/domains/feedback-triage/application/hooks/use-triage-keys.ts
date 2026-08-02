/**
 * Query keys for the feedback-triage domain.
 * Used by React Query for cache management and invalidation.
 */
export const feedbackTriageKeys = {
  all: ["admin", "feedback-triage"] as const,

  // Inbox queries
  inbox: () => [...feedbackTriageKeys.all, "inbox"] as const,
  inboxList: (filters: string) => [...feedbackTriageKeys.inbox(), "list", filters] as const,

  // Cluster queries
  clusters: () => [...feedbackTriageKeys.all, "clusters"] as const,
  clusterList: (filters: string) => [...feedbackTriageKeys.clusters(), "list", filters] as const,
  cluster: (id: string) => [...feedbackTriageKeys.clusters(), id] as const,

  // Cluster detail queries
  clusterDetail: (id: string) => [...feedbackTriageKeys.cluster(id), "detail"] as const,
  clusterTickets: (id: string) => [...feedbackTriageKeys.cluster(id), "tickets"] as const,
  clusterAttempts: (id: string) => [...feedbackTriageKeys.cluster(id), "attempts"] as const,
};
