export interface InstanceVersionInfo {
  /** Short SHA (7 chars) of the commit this build was compiled from. */
  current: string | null;
  /** Short SHA of the latest commit on `main` in the public repo. */
  latest: string | null;
  /** True when both SHAs are known and they differ. */
  updateAvailable: boolean;
  /** GitHub URL a human can click to review what changed. */
  compareUrl: string;
  /** ISO timestamp of the last successful GitHub poll. */
  checkedAt: string;
}

export interface VersionUpdateBannerProps {
  current: string | null;
  latest: string | null;
  compareUrl: string;
  sshHostHint: string | null;
  onDismiss: () => void;
  /**
   * When provided the banner renders an "Update now" CTA instead of the
   * fallback "Copy command" copy. Click triggers the click-to-update flow.
   */
  onUpdateNow?: () => void;
}

// ─── Click-to-update flow ──────────────────────────────────────────────────

export type UpdateStatus = "queued" | "running" | "success" | "failed";

export type UpdateStep =
  | "fetching"
  | "building"
  | "recreating"
  | "healthchecking"
  | "done";

export type UpdateLogSource = "stdout" | "stderr" | "system";

export interface UpdateLogLine {
  timestamp: string;
  source: UpdateLogSource;
  text: string;
}

export interface UpdateJob {
  id: string;
  status: UpdateStatus;
  step: UpdateStep | null;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  logTail: UpdateLogLine[];
  fromSha: string | null;
  toSha: string | null;
  errorMessage: string | null;
}

export interface UpdaterAvailability {
  available: boolean;
}

export interface StartUpdateResponse {
  jobId: string;
  startedAt: string;
  fromSha: string | null;
}
