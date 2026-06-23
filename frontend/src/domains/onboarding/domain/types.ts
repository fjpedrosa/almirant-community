export type OnboardingStepKey = "admin" | "tailscale" | "github";

export interface OnboardingStepStatus {
  done: boolean;
  skipped?: boolean;
}

export interface OnboardingAdminStatus extends OnboardingStepStatus {
  userCount: number;
}

export interface OnboardingTailscaleStatus extends OnboardingStepStatus {
  publicUrl: string | null;
}

export interface OnboardingGithubStatus extends OnboardingStepStatus {
  appSlug: string | null;
}

export interface OnboardingState {
  admin: OnboardingAdminStatus;
  tailscale: OnboardingTailscaleStatus;
  github: OnboardingGithubStatus;
  completedAt: string | null;
}

export interface TailscaleSetupState {
  available: boolean;
  hostname: string | null;
  tailnetName: string | null;
  suggestedUrl: string | null;
  serveStatus: {
    servingHttps: boolean;
    httpsTarget: string | null;
  } | null;
  reason?: string;
}

export interface TailscaleServeResult {
  success: boolean;
  publicUrl: string | null;
  copyPasteCommand: string;
}

export interface GithubAppFormValues {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  privateKeyPem: string;
}

export type GithubInstallTarget = "personal" | "org";

export interface GithubManifestForm {
  appName: string;
  installTarget: GithubInstallTarget;
  orgSlug: string;
}

export interface GithubAppStatus {
  configured: boolean;
  source: "db" | "env" | null;
  slug: string | null;
  appName: string | null;
}

// --- Presentational Props ---

export interface WizardShellProps {
  currentStep: OnboardingStepKey;
  onStepChange: (step: OnboardingStepKey) => void;
  adminDone: boolean;
  tailscaleDone: boolean;
  githubDone: boolean;
  canComplete: boolean;
  isCompleting: boolean;
  onComplete: () => void;
  children: React.ReactNode;
}

export interface StepAdminCardProps {
  userCount: number;
  adminEmail: string;
}

export interface StepTailscaleCardProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  // Tailscale tab
  available: boolean;
  hostname: string | null;
  suggestedUrl: string | null;
  reason?: string;
  publicUrl: string | null;
  isServing: boolean;
  onServe: () => void;
  serveResult: TailscaleServeResult | null;
  // Custom URL tab
  manualUrl: string;
  onManualUrlChange: (url: string) => void;
  isSavingUrl: boolean;
  onSaveManualUrl: () => void;
  detectedPublicUrl: string | null;
  onUseDetectedPublicUrl: () => void;
  // Skip
  isSkipping: boolean;
  onSkip: () => void;
  done: boolean;
}

export interface StepGithubCardProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  // Manifest tab
  hasPublicUrl: boolean;
  isCreatingApp: boolean;
  onCreateViaManifest: () => void;
  manifestForm: GithubManifestForm;
  onManifestFormChange: (
    field: keyof GithubManifestForm,
    value: string,
  ) => void;
  isManifestSubmittable: boolean;
  isTailscaleFunnel: boolean;
  // Manual tab
  formValues: GithubAppFormValues;
  onFormValueChange: (field: keyof GithubAppFormValues, value: string) => void;
  isSaving: boolean;
  onSaveManual: () => void;
  // Status
  configured: boolean;
  appSlug: string | null;
  hasInstallations: boolean;
  githubInstallUrl: string | null;
  isSyncingInstallations: boolean;
  onInstallGithubApp: () => void;
  onSyncInstallations: () => void;
  onCreateProject: () => void;
  // Skip
  isSkipping: boolean;
  onSkip: () => void;
  done: boolean;
}

export interface SetupCompletionBannerProps {
  pendingSteps: number;
  onGoToOnboarding: () => void;
  onDismiss: () => void;
}
