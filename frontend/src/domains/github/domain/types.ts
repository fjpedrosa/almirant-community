// ---------------------------------------------------------------------------
// GitHub Domain Types
// ---------------------------------------------------------------------------
// All types, interfaces, and component props for the GitHub domain.
// NO classes -- only types and interfaces following Clean Architecture.
// ---------------------------------------------------------------------------

// ---- Enums / Union Types --------------------------------------------------

export type GithubPrState = "open" | "closed" | "merged";

export type GithubReviewStatus =
  | "pending"
  | "approved"
  | "changes_requested"
  | "commented"
  | "dismissed";

export type GithubCiStatus =
  | "pending"
  | "queued"
  | "in_progress"
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "neutral";

export type GithubEventType =
  | "push"
  | "pull_request"
  | "pull_request_review"
  | "check_run"
  | "workflow_run"
  | "installation"
  | "deployment";

// ---- Data Interfaces ------------------------------------------------------

export interface GithubInstallation {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: "user" | "organization";
  accountAvatarUrl: string | null;
  repositorySelection: string | null;
  suspendedAt: string | null;
  createdAt: string;
}

export interface GithubPullRequest {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string | null;
  state: GithubPrState;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  labels: string[];
  reviewStatus: GithubReviewStatus;
  ciStatus: GithubCiStatus;
  baseBranch: string | null;
  headBranch: string | null;
  additions: number;
  deletions: number;
  htmlUrl: string | null;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
}

export interface GithubCommit {
  id: string;
  repoId: string;
  sha: string;
  message: string;
  authorLogin: string | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  branch: string | null;
  additions: number;
  deletions: number;
  committedAt: string;
}

export interface GithubWorkflowRun {
  id: string;
  repoId: string;
  runId: number;
  name: string | null;
  status: string | null;
  conclusion: string | null;
  branch: string | null;
  headSha: string | null;
  htmlUrl: string | null;
  event: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface GithubContributor {
  login: string;
  avatarUrl: string | null;
  name: string | null;
  commitCount: number;
}

export interface GithubEvent {
  id: string;
  repoId: string;
  eventType: GithubEventType;
  action: string | null;
  actorLogin: string | null;
  actorAvatarUrl: string | null;
  summary: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface GithubProjectSummary {
  openPrCount: number;
  lastCommitAt: string | null;
  lastDeployStatus: GithubCiStatus | null;
  lastDeployAt: string | null;
  lastDeployCommitSha: string | null;
  totalCommits: number;
  totalContributors: number;
  recentActivity: GithubEvent[];
}

export interface GithubConnectionStatus {
  configured: boolean;
  installations: GithubInstallation[];
  linkedRepos: Array<{ repoId: string; githubRepoFullName: string }>;
}

export interface GithubAvailableRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  html_url: string;
  default_branch: string;
  language: string | null;
  owner: {
    login: string;
    avatar_url: string;
  };
}

// ---- Request / Response Types -----------------------------------------------

export interface CreateGithubRepoRequest {
  name: string;
  description?: string;
  isPrivate?: boolean;
  autoInit?: boolean;
}

export interface CreateGithubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  description: string | null;
}

// ---- Component Props ------------------------------------------------------

export interface GithubPrItemProps {
  title: string;
  number: number;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  labels: string[];
  reviewStatus: GithubReviewStatus;
  ciStatus: GithubCiStatus;
  isDraft: boolean;
  createdAt: string;
  htmlUrl: string | null;
  additions: number;
  deletions: number;
}

export interface GithubPrListProps {
  pullRequests: GithubPullRequest[];
  isLoading: boolean;
}

export interface GithubCommitItemProps {
  sha: string;
  message: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  branch: string | null;
  committedAt: string;
}

export interface GithubCommitTimelineProps {
  commits: GithubCommit[];
  isLoading: boolean;
}

export interface GithubActionItemProps {
  name: string | null;
  status: string | null;
  conclusion: string | null;
  branch: string | null;
  htmlUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface GithubActionsListProps {
  workflowRuns: GithubWorkflowRun[];
  isLoading: boolean;
}

export interface GithubContributorsGridProps {
  contributors: GithubContributor[];
  isLoading: boolean;
}

export interface GithubActivityItemProps {
  eventType: GithubEventType;
  action: string | null;
  actorLogin: string | null;
  actorAvatarUrl: string | null;
  summary: string | null;
  createdAt: string;
}

export interface GithubActivityFeedProps {
  events: GithubEvent[];
  isLoading: boolean;
}

export interface GithubSummaryBadgesProps {
  openPrCount: number;
  lastCommitAt: string | null;
  lastDeployStatus: GithubCiStatus | null;
  githubRepoUrl: string | null;
}

export interface GithubDeployBadgeProps {
  status: GithubCiStatus | null;
}

export interface GithubRepoLinkProps {
  url: string;
}

export interface GithubSyncButtonProps {
  onSync: () => void;
  isSyncing: boolean;
  linkedRepoCount: number;
  lastSyncAt: string | null;
}

export interface GithubConnectionButtonProps {
  isConfigured: boolean;
  isConnected: boolean;
  githubAppSlug: string | undefined;
  onConnect: () => void;
  onDisconnect: () => void;
}

export interface GithubSetupGuideProps {
  githubAppSlug: string;
  installUrl: string;
}

export interface GithubManageInstallationsLinkProps {
  canAddRepositories?: boolean;
  onAddRepositories?: () => void;
}

export interface GithubConnectionStatusProps {
  status: GithubConnectionStatus;
  isLoading: boolean;
}

export interface GithubTabContainerProps {
  projectId: string;
}

// empty for now - fetches its own data
export interface GithubSettingsContainerProps {
  className?: string;
  returnTo?: "/onboarding" | "/settings/github";
}

export interface GithubAppSetupFormProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  formValues: import("@/domains/onboarding/domain/types").GithubAppFormValues;
  onValueChange: (
    field: keyof import("@/domains/onboarding/domain/types").GithubAppFormValues,
    value: string
  ) => void;
  onSubmit: () => void;
  onManifestClick: () => void;
  isSubmitting: boolean;
  isManifestDisabled: boolean;
  manifestDisabledReason?: string;
  error?: string | null;
  success?: boolean;
  // Manifest form fields (Coolify-style)
  manifestForm: import("@/domains/onboarding/domain/types").GithubManifestForm;
  onManifestFormChange: (
    field: keyof import("@/domains/onboarding/domain/types").GithubManifestForm,
    value: string
  ) => void;
  isManifestSubmittable: boolean;
  isTailscaleFunnel: boolean;
}

// ---- Tab Status Types ------------------------------------------------------

export type GithubTabStatus =
  | "not_connected"
  | "no_repos_linked"
  | "not_synced"
  | "synced";

export interface GithubEmptyStateProps {
  status: Exclude<GithubTabStatus, "synced">;
  onSync?: () => void;
  isSyncing?: boolean;
}

// ---- Error detection utilities -----------------------------------------------

/**
 * Check if an API error indicates an expired/revoked GitHub OAuth token.
 * Looks for the `GITHUB_TOKEN_EXPIRED` error code in the response.
 */
export const isGithubTokenExpiredError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;

  // Direct API response shape: { success: false, code: "GITHUB_TOKEN_EXPIRED" }
  if ("code" in error && (error as Record<string, unknown>).code === "GITHUB_TOKEN_EXPIRED") {
    return true;
  }

  // Error message fallback
  if ("message" in error) {
    const msg = String((error as Record<string, unknown>).message);
    return msg.includes("GITHUB_TOKEN_EXPIRED") || msg.includes("GitHub token expired");
  }

  return false;
};
