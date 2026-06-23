// ---------------------------------------------------------------------------
// Integrations domain types
// ---------------------------------------------------------------------------

// Provider identifiers for all supported integrations
export type ProviderType =
  | "github"
  | "gitlab"
  | "openai"
  | "anthropic"
  | "google"
  | "zai"
  | "xai"
  | "vercel"
  | "sentry"
  | "posthog"
  | "zipu"
  | "discord";

// Logical grouping of providers
export type ConnectionCategory = "code" | "ai" | "deployment" | "monitoring" | "communication";

// Whether the connection is user-level or organization-level
export type ConnectionScope = "user" | "organization";

// Organization-wide policy for AI key resolution
export type AiKeyPolicy =
  | "org_only"
  | "org_preferred"
  | "user_preferred"
  | "user_only";

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface ProviderConnection {
  id: string;
  provider: ProviderType;
  category: ConnectionCategory;
  scope: ConnectionScope;
  scopeId: string;
  name: string;
  accountIdentifier: string | null;
  isActive: boolean;
  isDefault: boolean;
  orchestrationEnabled: boolean;
  priority: number | null;
  lastUsedAt: string | null;
  suspendedAt: string | null;
  tokenExpiresAt: string | null;
  lastValidatedAt: string | null;
  lastValidationStatus: string | null;
  lastValidationError: string | null;
  config: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationSettings {
  id: string;
  organizationId: string;
  aiKeyPolicy: AiKeyPolicy;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Input DTOs
// ---------------------------------------------------------------------------

export interface CreateConnectionInput {
  provider: ProviderType;
  category: ConnectionCategory;
  scope: ConnectionScope;
  name: string;
  accountIdentifier?: string;
  isDefault?: boolean;
  credentials?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface UpdateConnectionInput {
  name?: string;
  accountIdentifier?: string;
  isActive?: boolean;
  isDefault?: boolean;
  orchestrationEnabled?: boolean;
  priority?: number;
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

export interface UpdateOrganizationSettingsInput {
  aiKeyPolicy?: AiKeyPolicy;
}

// ---------------------------------------------------------------------------
// API response helpers
// ---------------------------------------------------------------------------

export interface TestConnectionResult {
  valid: boolean;
  latencyMs?: number;
  error?: string;
}

export interface RefreshConnectionResult {
  refreshed: boolean;
  tokenExpiresAt: string | null;
}

export interface TestCredentialsInput {
  provider: string;
  credentials: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface OAuthUrlResponse {
  url: string;
  state: string;
}

export interface OAuthProviderInfo {
  name: string;
  provider: ProviderType;
  category: ConnectionCategory;
  supportsOAuth: boolean;
}

// ---------------------------------------------------------------------------
// OAuth flow state (used by use-oauth-flow hook)
// ---------------------------------------------------------------------------

export type OAuthFlowStep =
  | "idle"
  | "redirecting"
  | "waiting_callback"
  | "exchanging"
  | "success"
  | "error";

// ---------------------------------------------------------------------------
// Component prop types (for later presentation waves)
// ---------------------------------------------------------------------------

export interface ConnectionCardProps {
  connection: ProviderConnection;
  onTest: (id: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
  onRefresh: (id: string) => void;
  isTesting: boolean;
  testResult: TestConnectionResult | null;
}

export interface ConnectionListProps {
  connections: ProviderConnection[];
  isLoading: boolean;
  onCreateClick: () => void;
  onTest: (id: string) => void;
  onToggleActive: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
  onRefresh: (id: string) => void;
  testingId: string | null;
  testResults: Record<string, TestConnectionResult>;
}

export interface AiKeyPolicySelectorProps {
  value: AiKeyPolicy;
  onChange: (policy: AiKeyPolicy) => void;
  isUpdating: boolean;
}

export interface OAuthConnectButtonProps {
  provider: ProviderType;
  flowStep: OAuthFlowStep;
  onConnect: () => void;
  onCancel: () => void;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Integrations page types
// ---------------------------------------------------------------------------

/** Derived connection status for display purposes */
export type IntegrationConnectionStatus =
  | "connected"
  | "disconnected"
  | "inactive"
  | "suspended"
  | "expired";

/** Provider panel state for managing multi-key connections */
export interface ProviderPanelState {
  provider: ProviderType;
  scope: ConnectionScope;
  connections: ProviderConnection[];
  isOpen: boolean;
}

/** Static definition of a provider available for integration */
export interface IntegrationProviderDefinition {
  provider: ProviderType;
  name: string;
  description: string;
  category: ConnectionCategory;
  supportsOAuth: boolean;
  /** PostHog feature flag key that gates this provider's visibility */
  featureFlagKey?: string;
  /** When true, the provider is shown with a "Coming Soon" badge and is not clickable */
  comingSoon?: boolean;
}

/** A provider card item combining static definition with live connection data */
export interface IntegrationProviderItem {
  provider: ProviderType;
  name: string;
  description: string;
  category: ConnectionCategory;
  status: IntegrationConnectionStatus;
  connections: ProviderConnection[];
  isConnected: boolean;
  connectionCount: number;
  /** True when this provider is gated behind a feature flag */
  featureFlagged?: boolean;
  /** True when this provider is coming soon and not yet available */
  comingSoon?: boolean;
}

// ---------------------------------------------------------------------------
// Integrations page component props
// ---------------------------------------------------------------------------

export interface ConnectionStatusBadgeProps {
  status: IntegrationConnectionStatus;
}

export interface AiScopeSelectorProps {
  value: ConnectionScope;
  onChange: (scope: ConnectionScope) => void;
}

export interface WorkspaceOption {
  id: string;
  name: string;
}

export interface WorkspaceSelectorProps {
  value: string | null;
  options: WorkspaceOption[];
  isLoading: boolean;
  isSwitching: boolean;
  onChange: (workspaceId: string) => void;
}

export interface IntegrationsCategorySectionProps {
  label: string;
  providers: IntegrationProviderItem[];
  onCardClick: (item: IntegrationProviderItem) => void;
}

export interface IntegrationsGridProps {
  providers: IntegrationProviderItem[];
  isLoading: boolean;
  onCardClick: (item: IntegrationProviderItem) => void;
  /** Called when user clicks the placeholder card to add a new AI provider */
  onAddProviderClick?: () => void;
}

export type IntegrationsPageContainerProps = object;

// ---------------------------------------------------------------------------
// Provider panel component props
// ---------------------------------------------------------------------------

export interface AddKeyFormData {
  name: string;
  apiKey: string;
  baseUrl?: string;
  authMethod?: "api_key" | "setup_token" | "subscription";
  planningModel?: string;
  implementationModel?: string;
  validationModel?: string;
  planningReasoningBudget?: string;
  implementationReasoningBudget?: string;
  validationReasoningBudget?: string;
}

export interface AddKeyFormProps {
  provider: ProviderType;
  form: import("react-hook-form").UseFormReturn<AddKeyFormData>;
  onSubmit: (data: AddKeyFormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  isTesting: boolean;
  testError: string | null;
  availableModels: ModelDefinition[];
  showSubscriptionOption?: boolean;
  onSubscriptionClick?: () => void;
}

// ---------------------------------------------------------------------------
// Subscription wizard types
// ---------------------------------------------------------------------------

export type SubscriptionWizardStep =
  | "instructions"
  | "paste"
  | "oauth"
  | "cli"
  | "device-code"
  | "confirm";

export interface SubscriptionWizardProps {
  provider: ProviderType;
  step: SubscriptionWizardStep;
  tokenValue: string;
  tokenError: string | null;
  isValidating: boolean;
  isValid: boolean;
  connectionName: string;
  isSaving: boolean;
  onTokenChange: (value: string) => void;
  onConnectionNameChange: (value: string) => void;
  onNext: () => void;
  onBack: () => void;
  onSave: () => void;
  onCancel: () => void;
  // CLI flow props
  canUseCli: boolean;
  cliCommand: string | null;
  isPollingCli: boolean;
  cliError: string | null;
  onStartCli: () => void;
  // Device code flow props
  deviceCode: string | null;
  deviceVerificationUrl: string | null;
  isPollingDevice: boolean;
  deviceError: string | null;
}

export interface LinkTokenResponse {
  token: string;
  expiresAt: string;
}

export interface LinkTokenStatusResponse {
  status: "pending" | "completed";
  provider: string;
  credentials: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
  connectionName: string | null;
  expiresAt: string;
}

export interface ProviderKeyItemProps {
  connection: ProviderConnection;
  isDefault: boolean;
  isEditing: boolean;
  editName: string;
  editToken: string;
  onEditNameChange: (value: string) => void;
  onEditTokenChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onSetDefault: () => void;
  onTest: () => void;
  onDelete: () => void;
  isSaving: boolean;
  isTesting: boolean;
  testResult?: TestConnectionResult;
  usage: ConnectionUsageData | null;
  isLoadingUsage: boolean;
  isRefreshingUsage: boolean;
  onRefreshUsage: () => void | Promise<unknown>;
  priorityPosition?: number;
  totalConnections?: number;
  onMovePriorityUp?: () => void;
  onMovePriorityDown?: () => void;
  isReordering?: boolean;
  onToggleOrchestration?: () => void;
  onReconnect?: () => void;
}

export type ReconnectMode = "oauth" | "setup_token";

export interface ReconnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  connectionName: string;
  provider: ProviderType;
  // OAuth flow
  oauthState: string | null;
  isStartingOAuth: boolean;
  onStartOAuth: () => void;
  // Setup token flow
  setupTokenValue: string;
  onSetupTokenChange: (value: string) => void;
  isSubmittingSetupToken: boolean;
  onSubmitSetupToken: () => void;
  // Shared
  error: string | null;
  // OAuth code paste (Anthropic manual entry)
  oauthCodeValue: string;
  onOAuthCodeChange: (value: string) => void;
  isSubmittingOAuthCode: boolean;
  onSubmitOAuthCode: () => void;
}

// ---------------------------------------------------------------------------
// API Key connect dialog types
// ---------------------------------------------------------------------------

/** Providers that support API key connection (excludes OAuth-only providers) */
export type ApiKeyProvider = Exclude<ProviderType, "github" | "vercel" | "discord">;

/** Auth method for Anthropic connections */
export type AnthropicAuthMethod = "api_key" | "setup_token" | "subscription";

/** Form data shape for the API key connect form */
export interface ApiKeyConnectFormData {
  name: string;
  provider: ApiKeyProvider;
  apiKey?: string;
  baseUrl?: string;
  authMethod?: AnthropicAuthMethod;
  planningModel?: string;
  implementationModel?: string;
  validationModel?: string;
  planningReasoningBudget?: string;
  implementationReasoningBudget?: string;
  validationReasoningBudget?: string;
  connectionId?: string;
}

export interface ApiKeyManageConnection {
  id: string;
  name: string;
  config: Record<string, unknown> | null;
}

/** Props for the presentational API Key connect dialog */
export interface ApiKeyConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: import("react-hook-form").UseFormReturn<ApiKeyConnectFormData>;
  onSubmit: (data: ApiKeyConnectFormData) => void;
  isSubmitting: boolean;
  isFormValid: boolean;
  selectedProvider: ApiKeyProvider;
  isTesting: boolean;
  testError: string | null;
  isEditing: boolean;
  /** When true, the provider was pre-selected from a card and the selector is hidden */
  providerLocked: boolean;
  availableModels: ModelDefinition[];
  showSubscriptionOption?: boolean;
  onSubscriptionClick?: () => void;
}

/** Return type for the useApiKeyConnectForm hook */
export interface UseApiKeyConnectFormReturn {
  form: import("react-hook-form").UseFormReturn<ApiKeyConnectFormData>;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  onSubmit: (data: ApiKeyConnectFormData) => void;
  isSubmitting: boolean;
  isFormValid: boolean;
  selectedProvider: ApiKeyProvider;
  isTesting: boolean;
  testError: string | null;
  isEditing: boolean;
  /** When true, the provider was pre-selected from a card click */
  providerLocked: boolean;
  /** Open dialog with a pre-selected (locked) provider */
  openForProvider: (
    provider: ApiKeyProvider,
    scope?: ConnectionScope,
    existing?: ApiKeyManageConnection
  ) => void;
  availableModels: ModelDefinition[];
}

// ---------------------------------------------------------------------------
// OAuth connect dialog types
// ---------------------------------------------------------------------------

/** Providers that support OAuth connection */
export type OAuthProvider = Extract<ProviderType, "github" | "vercel">;

/** Props for the presentational OAuth connect dialog */
export interface OAuthConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: OAuthProvider;
  providerName: string;
  providerDescription: string;
  flowStep: OAuthFlowStep;
  error: string | null;
  onConnect: () => void;
  onCancel: () => void;
}

/** Return type for the useOAuthConnect hook */
export interface UseOAuthConnectReturn {
  dialogOpen: boolean;
  activeProvider: OAuthProvider | null;
  providerName: string;
  providerDescription: string;
  flowStep: OAuthFlowStep;
  error: string | null;
  openDialog: (provider: OAuthProvider) => void;
  closeDialog: () => void;
  handleConnect: () => void;
}

// ---------------------------------------------------------------------------
// Add provider panel types
// ---------------------------------------------------------------------------

export interface UseAddProviderPanelParams {
  apiKeyForm: UseApiKeyConnectFormReturn;
  connections: ProviderConnection[];
  aiScope: ConnectionScope;
}

export interface UseAddProviderPanelReturn {
  /** Whether the add-provider panel is open */
  isOpen: boolean;
  /** AI providers that are not yet connected */
  availableProviders: IntegrationProviderDefinition[];
  /** Open the add-provider panel */
  open: () => void;
  /** Close the add-provider panel */
  close: () => void;
  /** Handle provider selection: closes panel and opens the appropriate dialog */
  handleSelectProvider: (provider: ProviderType) => void;
}

/** Props for the add-provider Sheet component */
export interface AddProviderPanelSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: IntegrationProviderDefinition[];
  onSelectProvider: (provider: ProviderType) => void;
}

export interface UseIntegrationsPageReturn {
  providers: IntegrationProviderItem[];
  isLoading: boolean;
  aiScope: ConnectionScope;
  setAiScope: (scope: ConnectionScope) => void;
  workspaces: WorkspaceOption[];
  activeWorkspaceId: string | null;
  isLoadingWorkspaces: boolean;
  isSwitchingWorkspace: boolean;
  onWorkspaceChange: (workspaceId: string) => void;
  handleConnect: (provider: ProviderType) => void;
  handleManage: (provider: ProviderType) => void;
  handleResync: () => void;
  handleDisconnect: (connectionId: string) => void;
  handleDisconnectProvider: (connectionId: string, providerName: string) => void;
  isResyncing: boolean;
  apiKeyForm: UseApiKeyConnectFormReturn;
  oauthConnect: UseOAuthConnectReturn;
  confirmDialogProps: {
    isOpen: boolean;
    options: import("@/domains/shared/domain/types").ConfirmDialogOptions | null;
    handleConfirm: () => void;
    handleCancel: () => void;
  };
  providerPanelState: ProviderPanelState | null;
  setProviderPanelState: (state: ProviderPanelState | null) => void;
  subscriptionConnect: import("../application/hooks/use-subscription-connect").UseSubscriptionConnectReturn;
  handleSubscriptionFromDialog: (provider?: ApiKeyProvider) => void;
}

// ---------------------------------------------------------------------------
// GitHub account picker dialog types
// ---------------------------------------------------------------------------

/** A GitHub App installation available for connection */
export interface GitHubAvailableInstallation {
  installationId: number;
  accountLogin: string;
  accountAvatarUrl: string | null;
  accountType: "User" | "Organization";
  isConnected: boolean;
  connectionId?: string | null;
}

/** Props for the presentational GitHub account picker dialog */
export interface GitHubAccountPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installations: GitHubAvailableInstallation[];
  isLoading: boolean;
  connectingId: number | null;
  onConnect: (installationId: number) => void;
  onInstallNew: () => void;
  canInstallNew: boolean;
  error: string | null;
  hasPersonalOAuth: boolean;
  onConnectPersonal: () => void;
  onReconnectPersonal: () => void;
  isConnectingPersonal: boolean;
}

/** Return type for the useGitHubAccountPicker hook */
export interface UseGitHubAccountPickerReturn {
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  installations: GitHubAvailableInstallation[];
  isLoading: boolean;
  connectingId: number | null;
  handleConnect: (installationId: number) => void;
  handleInstallNew: () => void;
  canInstallNew: boolean;
  error: string | null;
  hasPersonalOAuth: boolean;
  personalOAuthConnection: ProviderConnection | undefined;
  connectPersonalAccount: () => void;
  isConnectingPersonal: boolean;
}

// ---------------------------------------------------------------------------
// Observability types - Sentry
// ---------------------------------------------------------------------------

export interface SentryIssue {
  id: string;
  title: string;
  shortId: string;
  count: string;
  level: "fatal" | "error" | "warning" | "info" | "debug";
  lastSeen: string;
  firstSeen: string;
  culprit: string;
  status: string;
  permalink: string;
  metadata: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
}

/** A single [timestamp, count] data point from Sentry project stats */
export type SentryStatsPoint = [number, number];

// ---------------------------------------------------------------------------
// Observability types - PostHog
// ---------------------------------------------------------------------------

export interface PosthogInsight {
  id: number;
  name: string | null;
  description: string | null;
  favorited: boolean;
  last_refresh: string | null;
  result: unknown;
  filters: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PosthogEvent {
  id: string;
  event: string;
  timestamp: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  elements: unknown[];
}

// ---------------------------------------------------------------------------
// Observability component props
// ---------------------------------------------------------------------------

export interface SentryOverviewProps {
  issues: SentryIssue[];
  isLoading: boolean;
  error: string | null;
}

export interface PosthogOverviewProps {
  insights: PosthogInsight[];
  events: PosthogEvent[];
  isLoadingInsights: boolean;
  isLoadingEvents: boolean;
  insightsError: string | null;
  eventsError: string | null;
}

// ---------------------------------------------------------------------------
// Redesign: Minimal cards + Panel sheet
// ---------------------------------------------------------------------------

/** Shared form state for adding API keys (moved from use-provider-panel) */
export interface AddKeyFormState {
  form: import("react-hook-form").UseFormReturn<AddKeyFormData>;
  isVisible: boolean;
  showForm: () => void;
  hideForm: () => void;
  onSubmit: (data: AddKeyFormData) => Promise<void>;
  isSubmitting: boolean;
  isTesting: boolean;
  testError: string | null;
}

/** Props for the minimal provider card (icon + name + status dot) */
export interface ProviderCardMinimalProps {
  provider: ProviderType;
  name: string;
  status: IntegrationConnectionStatus;
  /** Optional subtitle below the name (e.g. "2 API keys") */
  subtitle?: string;
  /** True when this provider is gated behind a feature flag (shows admin indicator) */
  featureFlagged?: boolean;
  /** True when this provider is coming soon (shows badge, non-interactive) */
  comingSoon?: boolean;
  onClick: () => void;
}

/** Props for the placeholder card to add a new AI provider */
export interface AddProviderPlaceholderCardProps {
  /** When true, renders the empty state variant (larger card with invitational message) */
  isEmpty: boolean;
  /** Called when the user clicks or activates the card */
  onClick: () => void;
}

/** Props for the small colored status dot indicator */
export interface ProviderStatusDotProps {
  status: IntegrationConnectionStatus;
}

// ---------------------------------------------------------------------------
// Connection usage types
// ---------------------------------------------------------------------------

export type ConnectionUsageSource =
  | "admin_api"
  | "oauth_usage"
  | "not_available"
  | "admin_key_required"
  | "rate_limited"
  | "error";

export interface OAuthUsageWindow {
  utilization: number;
  resetsAt: string;
}

export interface OAuthExtraUsage {
  isEnabled: boolean;
  monthlyLimit: number;
  usedCredits: number;
  utilization: number;
  currency: string;
}

export interface OAuthProviderStatus {
  provider: "openai";
  planType: string | null;
  allowed: boolean | null;
  limitReached: boolean;
  limitReachedType: string | null;
  accountIdentifier: string | null;
  fetchedAt: string;
}

export interface OAuthUsageData {
  fiveHour?: OAuthUsageWindow;
  sevenDay?: OAuthUsageWindow;
  sevenDayOpus?: OAuthUsageWindow;
  sevenDaySonnet?: OAuthUsageWindow;
  providerStatus?: OAuthProviderStatus;
  extraUsage: OAuthExtraUsage;
}

export interface OpenAiUsageModelData {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requests: number;
  estimatedCostUsd: number | null;
}

export interface OpenAiProviderUsageData {
  billingPeriod: { startDate: string; endDate: string };
  estimatedCostUsd: number;
  billedCostUsd: number | null;
  currency: string;
  models: OpenAiUsageModelData[];
}

export interface ConnectionUsageData {
  supported: boolean;
  source: ConnectionUsageSource;
  period: { startDate: string; endDate: string };
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    requests: number;
  };
  oauthUsage?: OAuthUsageData;
  providerUsage?: {
    openai?: OpenAiProviderUsageData;
  };
}

export type PacingStatus = "ahead" | "on-track" | "behind";

export interface PacingResult {
  expectedPercent: number;
  actualPercent: number;
  deviationPercent: number;
  status: PacingStatus;
}

export type UsageSummaryWindowKey =
  | "fiveHour"
  | "sevenDay"
  | "sevenDayOpus"
  | "sevenDaySonnet";

export interface UsageSummaryResponseItem {
  connectionId: string;
  provider: ProviderType;
  name: string;
  accountIdentifier: string | null;
  usage: ConnectionUsageData;
}

export interface UsageSummaryWindow {
  key: UsageSummaryWindowKey;
  utilization: number;
  resetsAt: string;
  periodHours: number;
  hoursUntilReset: number;
  pacing: PacingResult;
}

export interface UsageSummaryAccount extends UsageSummaryResponseItem {
  windows: UsageSummaryWindow[];
  hasAheadPacing: boolean;
}

export interface UtilizationMeterProps {
  percent: number;
  label: string;
  formattedTimeLeft?: string;
  isExpired?: boolean;
  warningThreshold?: number;
  criticalThreshold?: number;
  expectedPercent?: number;
  pacingLabel?: string;
}

export interface OAuthUsageDisplayProps {
  oauthUsage: OAuthUsageData;
  timers: {
    fiveHour: { formattedTimeLeft: string; isExpired: boolean };
    sevenDay: { formattedTimeLeft: string; isExpired: boolean };
    sevenDayOpus: { formattedTimeLeft: string; isExpired: boolean };
    sevenDaySonnet: { formattedTimeLeft: string; isExpired: boolean };
  };
}

/** Props for the slide-in sheet panel */
export interface ProviderPanelSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: ProviderType;
  providerName: string;
  status: IntegrationConnectionStatus;
  scope: ConnectionScope;
  // Connection section
  connections: ProviderConnection[];
  isLoadingConnections: boolean;
  connectionCount: number;
  // Model section
  availableModels: ModelDefinition[];
  modelSettings: {
    planningModel: string;
    implementationModel: string;
    validationModel: string;
    planningReasoningBudget: string;
    implementationReasoningBudget: string;
    validationReasoningBudget: string;
  };
  hasModelChanges: boolean;
  isSavingModelSettings: boolean;
  onModelSettingChange: (field: "planningModel" | "implementationModel" | "validationModel" | "planningReasoningBudget" | "implementationReasoningBudget" | "validationReasoningBudget", value: string) => void;
  onSaveModelSettings: () => void;
  isModelsSectionExpanded: boolean;
  onModelsSectionExpandedChange: (expanded: boolean) => void;
  // API Keys section
  defaultConnectionId: string | null;
  editingConnectionId: string | null;
  editName: string;
  editToken: string;
  isSavingEdit: boolean;
  onStartEdit: (connectionId: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onSetEditName: (value: string) => void;
  onSetEditToken: (value: string) => void;
  onSetDefault: (connectionId: string) => void;
  onDeleteKey: (connectionId: string) => void;
  onTestKey: (connectionId: string) => void;
  onAddKeyClick: () => void;
  testingStates: Record<string, boolean>;
  testResults: Record<string, TestConnectionResult>;
  showSubscriptionOption?: boolean;
  onSubscriptionClick?: () => void;
  onMovePriorityUp?: (connectionId: string) => void;
  onMovePriorityDown?: (connectionId: string) => void;
  isReordering?: boolean;
  onToggleOrchestration?: (connectionId: string) => void;
  onReconnect?: (connectionId: string) => void;
}

/** Props for the Models collapsible section inside the panel */
export interface ModelsSectionProps {
  provider: ProviderType;
  availableModels: ModelDefinition[];
  modelSettings: {
    planningModel: string;
    implementationModel: string;
    validationModel: string;
    planningReasoningBudget: string;
    implementationReasoningBudget: string;
    validationReasoningBudget: string;
  };
  hasModelChanges: boolean;
  isSavingModelSettings: boolean;
  onModelSettingChange: (field: "planningModel" | "implementationModel" | "validationModel" | "planningReasoningBudget" | "implementationReasoningBudget" | "validationReasoningBudget", value: string) => void;
  onSaveModelSettings: () => void;
  connectionCount: number;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

/** Props for the API Keys collapsible section inside the panel */
export interface ApiKeysSectionProps {
  provider: ProviderType;
  connections: ProviderConnection[];
  isLoading: boolean;
  defaultConnectionId: string | null;
  editingConnectionId: string | null;
  editName: string;
  editToken: string;
  isSavingEdit: boolean;
  onStartEdit: (connectionId: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onSetEditName: (value: string) => void;
  onSetEditToken: (value: string) => void;
  onSetDefault: (connectionId: string) => void;
  onDeleteKey: (connectionId: string) => void;
  onTestKey: (connectionId: string) => void;
  onAddKeyClick: () => void;
  testingStates: Record<string, boolean>;
  testResults: Record<string, TestConnectionResult>;
  availableModels: ModelDefinition[];
  showSubscriptionOption?: boolean;
  onSubscriptionClick?: () => void;
  onMovePriorityUp?: (connectionId: string) => void;
  onMovePriorityDown?: (connectionId: string) => void;
  isReordering?: boolean;
  onToggleOrchestration?: (connectionId: string) => void;
  onReconnect?: (connectionId: string) => void;
}

// ---------------------------------------------------------------------------
// AI Model catalog types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Provider Usage Panel types
// ---------------------------------------------------------------------------

export interface ProviderGroup {
  provider: ProviderType;
  connections: ProviderConnection[];
}

export interface ProviderUsagePanelSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedWorkspaceId: string | null;
  workspaceOptions: { id: string; name: string }[];
  onWorkspaceChange: (workspaceId: string) => void;
  providerGroups: ProviderGroup[];
  isLoading: boolean;
  onRefreshAll: () => void;
  isRefreshingAll: boolean;
}

export interface ConnectionUsageRowProps {
  connection: ProviderConnection;
  usage: ConnectionUsageData | null;
  isLoading: boolean;
  timers?: {
    fiveHour: { formattedTimeLeft: string; isExpired: boolean };
    sevenDay: { formattedTimeLeft: string; isExpired: boolean };
    sevenDayOpus: { formattedTimeLeft: string; isExpired: boolean };
    sevenDaySonnet: { formattedTimeLeft: string; isExpired: boolean };
  };
  /** Callback to trigger a manual refresh of usage data */
  onRefresh?: () => void;
  /** Whether a refresh is currently in progress */
  isRefreshing?: boolean;
  /** Formatted relative time since last refresh (e.g., "2 minutes") */
  lastRefreshedRelative?: string;
}

export interface UsageAccountCardWindowData {
  id: string;
  label: string;
  percent: number;
  formattedTimeLeft: string;
  isExpired: boolean;
  expectedPercent: number;
  status: PacingStatus;
  statusLabel: string;
  deviationLabel: string;
}

export interface UsageAccountCardData {
  id: string;
  provider: string;
  providerLabel: string;
  name: string;
  accountIdentifier: string | null;
  providerStatus?: OAuthProviderStatus;
  source: ConnectionUsageSource;
  tokens: number;
  requests: number;
  costUsd: number;
  windows: UsageAccountCardWindowData[];
  onRefresh?: () => void;
  isRefreshing?: boolean;
  lastRefreshedLabel?: string;
}

export interface UsageAccountCardProps {
  account: UsageAccountCardData;
  usageUnavailableLabel: string;
  adminKeyRequiredLabel: string;
  tokensLabel: string;
  requestsLabel: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  lastRefreshedLabel?: string;
}

export interface UsageDrawerContainerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface UsageDrawerContentProps
  extends UsageDrawerContainerProps {
  title: string;
  isLoading: boolean;
  isEmpty: boolean;
  children: React.ReactNode;
  emptyTitle: string;
  emptyDescription: string;
  manageConnectionsHref: string;
  manageConnectionsLabel: string;
}

// ---------------------------------------------------------------------------
// AI Model catalog types
// ---------------------------------------------------------------------------

export type ReasoningBudget =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "enabled"
  | "disabled";

export type ModelCategory = "best" | "fast" | "cheap" | "reasoning";

export interface ModelDefinition {
  id: string;
  displayName: string;
  category: ModelCategory;
}

// ---------------------------------------------------------------------------
// Discord Notification Preferences types
// ---------------------------------------------------------------------------

/** Keys that represent toggleable notification preferences */
export type NotificationPrefKey =
  | "notifyWorkItemCreated"
  | "notifyWorkItemMoved"
  | "notifyWorkItemAssigned"
  | "notifyWorkItemDone"
  | "notifyWorkItemComment"
  | "notifyWorkItemUpdated"
  | "notifyWorkItemDeleted"
  | "notifyCommentAdded"
  | "notifyAttachmentAdded"
  | "notifySprintStarted"
  | "notifySprintClosed"
  | "notifyMilestoneCompleted"
  | "notifyPrOpened"
  | "notifyPrMerged"
  | "notifyCiFailed"
  | "notifyAgentJobCompleted"
  | "notifyAgentJobFailed"
  | "notifySeedPromoted";

export interface NotificationToggleItem {
  key: NotificationPrefKey;
  label: string;
}

export interface NotificationCategory {
  name: string;
  toggles: NotificationToggleItem[];
}

/** Local state for the notification prefs form (only toggleable booleans + enabled) */
export type NotificationPrefsFormState = Record<NotificationPrefKey, boolean> & {
  enabled: boolean;
};

export interface DiscordNotificationPrefsPanelProps {
  categories: NotificationCategory[];
  formState: NotificationPrefsFormState;
  isLoading: boolean;
  isSaving: boolean;
  hasChanges: boolean;
  onToggle: (key: NotificationPrefKey | "enabled", value: boolean) => void;
  onMasterToggle: (value: boolean) => void;
  onSave: () => void;
  onDiscard: () => void;
}

// ---------------------------------------------------------------------------
// Discord connection card types (Settings > Integrations)
// ---------------------------------------------------------------------------

export interface DiscordConnectionCardProps {
  connection: {
    id: string;
    guildName: string | null;
    defaultChannelId: string | null;
    defaultChannelName: string | null;
    isActive: boolean;
  } | null;
  channels: { id: string; name: string; type: string; position: number; parentId: string | null }[];
  selectedChannelId: string | null;
  isLoading: boolean;
  isConnecting: boolean;
  isSaving: boolean;
  isTesting: boolean;
  isDisconnecting: boolean;
  testResult: { sent: boolean; error?: string } | null;
  hasChannelChanges: boolean;
  onConnect: () => void;
  onChannelSelect: (channelId: string) => void;
  onSaveChannel: () => void;
  onDiscardChannel: () => void;
  onTestConnection: () => void;
  onDisconnect: () => void;
}

export interface UseDiscordConnectionReturn {
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  connection: {
    id: string;
    guildName: string | null;
    defaultChannelId: string | null;
    defaultChannelName: string | null;
    isActive: boolean;
  } | null;
  channels: { id: string; name: string; type: string; position: number; parentId: string | null }[];
  selectedChannelId: string | null;
  isLoading: boolean;
  isConnecting: boolean;
  isSaving: boolean;
  isTesting: boolean;
  isDisconnecting: boolean;
  testResult: { sent: boolean; error?: string } | null;
  hasChannelChanges: boolean;
  handleConnect: () => void;
  handleChannelSelect: (channelId: string) => void;
  handleSaveChannel: () => void;
  handleDiscardChannel: () => void;
  handleTestConnection: () => void;
  handleDisconnect: () => void;
}
