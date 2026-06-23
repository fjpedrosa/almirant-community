import type React from "react";
import type { ProjectNightlyValidationSettings } from "@/domains/projects/domain/types";

export interface SettingsSection {
  id: string;
  name: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  isBeta?: boolean;
}

export interface SettingsNavProps {
  sections: SettingsSection[];
  activeSection?: string;
  betaLabel: string;
}

export interface SettingsSectionGroup {
  id: string;
  label: string;
  sections: SettingsSection[];
}

export interface SettingsSidebarProps {
  groups: SettingsSectionGroup[];
  activeSection?: string;
  title: string;
  subtitle: string;
  betaLabel: string;
}

export interface SettingsLayoutProps {
  groups: SettingsSectionGroup[];
  activeSection?: string;
  title: string;
  subtitle: string;
  betaLabel: string;
  children: React.ReactNode;
}

export type SettingsPageContainerProps = object;

export interface LocaleOption {
  value: string;
  label: string;
  flag: string;
}

export interface LocaleSelectorProps {
  currentLocale: string;
  locales: LocaleOption[];
  isUpdating: boolean;
  onLocaleChange: (locale: string) => void;
}

export type ThemeOption = "light" | "dark" | "system";

export interface ThemeSelectorProps {
  currentTheme: ThemeOption | undefined;
  mounted: boolean;
  onThemeChange: (theme: ThemeOption) => void;
}

export interface ChangePasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface ChangePasswordSectionProps {
  values: ChangePasswordFormValues;
  isSubmitting: boolean;
  error: string | null;
  onValueChange: (field: keyof ChangePasswordFormValues, value: string) => void;
  onSubmit: () => void | Promise<void>;
}

export interface ClaudeSetupProjectOption {
  id: string;
  name: string;
}

export interface ClaudeSetupApiKeyOption {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
}

export interface EmailNotificationSettings {
  id: string;
  userId: string;
  enabled: boolean;
  notifyWorkItemMoved: boolean;
  notifyWorkItemAssigned: boolean;
  notifyWorkItemDone: boolean;
  notifyReviewCompleted: boolean;
  notifySprintClosed: boolean;
  notifyUserActions: boolean;
  createdAt: string;
  updatedAt: string;
}

export type EmailNotificationToggleKey = Extract<
  keyof EmailNotificationSettings,
  | "enabled"
  | "notifyWorkItemMoved"
  | "notifyWorkItemAssigned"
  | "notifyWorkItemDone"
  | "notifyReviewCompleted"
  | "notifySprintClosed"
  | "notifyUserActions"
>;

export interface EmailNotificationSettingsProps {
  settings: EmailNotificationSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  onToggle: (key: EmailNotificationToggleKey, value: boolean) => void;
}

export interface ClaudeCodeSetupProps {
  isLoading: boolean;
  projectOptions: ClaudeSetupProjectOption[];
  apiKeyOptions: ClaudeSetupApiKeyOption[];
  selectedProjectId: string;
  selectedApiKeyId: string;
  snippet: string;
  isConnected: boolean;
  docsUrl: string;
  onProjectChange: (projectId: string) => void;
  onApiKeyChange: (apiKeyId: string) => void;
  onCopySnippet: () => void;
}

export type Tier = "free" | "pro" | "business" | "enterprise";

export interface TierConfig {
  name: string;
  minuteLimit: number;
}

export const TIER_CONFIGS: Record<Tier, TierConfig> = {
  free: { name: "Free", minuteLimit: 500 },
  pro: { name: "Pro", minuteLimit: 5_000 },
  business: { name: "Business", minuteLimit: 25_000 },
  enterprise: { name: "Enterprise", minuteLimit: 0 },
};

export interface UsageTierInfo {
  tier: Tier;
  tierName: string;
  tierMinuteLimit: number;
  isUnlimited: boolean;
}

export interface UsageTierCtaProps {
  totalMinutesUsed: number;
  tierMinuteLimit: number;
  tierName: string;
  daysRemaining: number;
  isLoading: boolean;
  upgradeHref?: string;
}

export type UsageTimeRange = "7d" | "30d" | "90d" | "12m";

export interface DailyUsageEntry {
  date: string;
  totalSeconds: number;
  totalJobs: number;
  breakdown: Record<string, number>;
}

export type OrchestrationStrategy = "round_robin" | "sequential" | "reset_first";

export interface OrchestrationSettingsData {
  orchestrationStrategy: OrchestrationStrategy | null;
}

export interface OrchestrationConnectionInfo {
  id: string;
  name: string;
  provider: string;
  isActive: boolean;
  orchestrationEnabled: boolean;
  suspendedAt: string | null;
}

export interface OrchestrationSettingsProps {
  strategy: OrchestrationStrategy | null;
  isLoading: boolean;
  isSaving: boolean;
  connections: OrchestrationConnectionInfo[];
  isLoadingConnections: boolean;
  onStrategyChange: (strategy: OrchestrationStrategy | null) => void;
}

export interface NightlyValidationProjectOption {
  id: string;
  name: string;
}

export interface NightlyValidationSectionProps {
  projectOptions: NightlyValidationProjectOption[];
  selectedProjectId: string;
  isLoadingProjects: boolean;
  settings: ProjectNightlyValidationSettings | null;
  isLoadingSettings: boolean;
  isSaving: boolean;
  hasChanges: boolean;
  errorMessage: string | null;
  onProjectChange: (projectId: string) => void;
  onChange: (
    field: keyof ProjectNightlyValidationSettings,
    value: ProjectNightlyValidationSettings[keyof ProjectNightlyValidationSettings]
  ) => void;
  onSave: () => void;
  onDiscard: () => void;
}
