"use client";

/**
 * Downstream distributions may replace this module with a drill-down panel
 * for the agent job backing a cluster-investigation bug-fix attempt
 * (transcript, structured logs, invocation metadata, resource timeline).
 *
 * Community keeps the default implementation inert: it renders nothing.
 * The real implementation (Almirant Cloud's `AgentRunDetailContainer`)
 * reads the agent job through the cross-workspace admin agent-jobs surface
 * (`GET /admin/agent-jobs/*`, SaaS-operator-only visibility across every
 * customer workspace) — a genuinely cloud-only capability with no
 * self-hosted equivalent, since community's admin role is scoped to a
 * single instance rather than many tenant workspaces.
 *
 * Mirrors the seam already used for the signup funnel in
 * `signup-lifecycle-observer.ts` and for click analytics in
 * `posthog-click-tracking.tsx`.
 */
export interface ClusterInvestigationAgentRunSlotProps {
  jobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ClusterInvestigationAgentRunSlot: React.FC<
  ClusterInvestigationAgentRunSlotProps
> = () => null;
