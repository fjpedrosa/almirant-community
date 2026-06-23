// Extension points for CE/EE separation.
// Implementations are registered at bootstrap via registry.ts.

// ---------------------------------------------------------------------
// AuthProviderRegistry — login/auth provider selection
// ---------------------------------------------------------------------

export interface AuthProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly type: "oauth" | "credentials" | "saml" | "oidc";
}

export interface AuthProviderRegistry {
  list(): readonly AuthProviderDescriptor[];
  has(id: string): boolean;
}

// ---------------------------------------------------------------------
// ActivityLogger — user action audit trail
// ---------------------------------------------------------------------

export interface ActivityLogEntry {
  actorUserId: string;
  organizationId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

export interface ActivityLogger {
  /** Fire-and-forget by design. Must never throw. */
  log(entry: ActivityLogEntry): void;
}

// ---------------------------------------------------------------------
// PermissionChecker — authorization decisions
// ---------------------------------------------------------------------

export interface PermissionSubject {
  userId: string;
  organizationId: string | null;
  role: string | null;
}

export interface PermissionChecker {
  can(
    subject: PermissionSubject,
    action: string,
    resource?: { type: string; id: string; ownerId?: string }
  ): boolean;
}

// ---------------------------------------------------------------------
// RunnerOrchestrator — agent runner management
// ---------------------------------------------------------------------

export interface RunnerMetrics {
  totalRunners: number;
  activeRunners: number;
  idleRunners: number;
  pendingJobs: number;
  /**
   * Optional extended metrics.  The CE scaler emits these via Prometheus; EE
   * implementations may populate them differently.  `null` means the backing
   * metric exists in the interface but was not reported by the scaler (e.g.
   * the Prometheus export omits the key).
   */
  targetRunners?: number | null;
  uptimeSeconds?: number | null;
  /**
   * Human-readable reason the orchestrator is unavailable.  Reserved for EE
   * implementations that want to distinguish between "not configured" and
   * "configured-but-down" without forcing `getMetrics()` to return `null`.
   */
  unavailableReason?: string | null;
}

export interface RunnerOrchestrator {
  /** Returns operational metrics. Null if metrics backend is unavailable. */
  getMetrics(): Promise<RunnerMetrics | null>;
}

// ---------------------------------------------------------------------
// FeedbackProcessor — feedback ingestion and triage
// ---------------------------------------------------------------------

export interface FeedbackIngestInput {
  organizationId: string;
  projectId: string | null;
  title: string;
  body: string;
  category: string | null;
  userId: string | null;
}

export interface FeedbackIngestResult {
  feedbackId: string;
  triaged: boolean;
}

export interface FeedbackProcessor {
  ingest(input: FeedbackIngestInput): Promise<FeedbackIngestResult>;
}
