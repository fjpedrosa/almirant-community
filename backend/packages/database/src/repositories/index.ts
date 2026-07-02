// ── project-management ──
export * from "./project-management/tag-repository";
export * from "./project-management/webhook-repository";
export * from "./project-management/import-repository";
export * from "./project-management/project-repository";
export * from "./project-management/project-member-repository";
export * from "./project-management/doc-link-repository";
export * from "./project-management/note-repository";
export * from "./project-management/board-repository";
export * from "./project-management/work-item-repository";
export * from "./project-management/dod-remediation-repository";
export * from "./project-management/dependency-repository";
export * from "./project-management/work-item-commit-repository";
export * from "./project-management/work-item-event-repository";
export * from "./project-management/attachment-repository";
export * from "./project-management/sprint-repository";
export * from "./project-management/milestone-repository";
export * from "./project-management/sprint-documents-repository";
export * from "./project-management/roadmap-repository";
export * from "./project-management/roadmap-dates";
export * from "./project-management/saved-view-repository";
export * from "./project-management/assignee-repository";
export * from "./project-management/user-view-preference-repository";
export * from "./project-management/entity-comment-repository";
export * from "./project-management/entity-event-repository";
export * from "./project-management/integration-batch-repository";

// ── ideation ──
export * from "./ideation/idea-item-repository";
export * from "./ideation/idea-item-comment-repository";
export * from "./ideation/seed-repository";
export * from "./ideation/todo-item-repository";
export * from "./ideation/planning-session-repository";

// ── agents ──
export * from "./agents/agent-job-repository";
export * from "./agents/agent-job-log-repository";
export * from "./agents/agent-observation-repository";
export * from "./agents/agent-memory-telemetry-repository";
export * from "./agents/worker-interaction-repository";
export * from "./agents/worker-repository";
export * from "./agents/worker-lifecycle-repository";
export * from "./agents/worker-metrics-repository";
export * from "./agents/scheduled-agent-config-repository";
export * from "./agents/scheduled-agent-run-repository";
export * from "./agents/skill-repository";
export * from "./agents/session-event-repository";
export * from "./agents/session-state-repository";
export * from "./agents/native-event-repository";
export * from "./agents/event-archive-repository";
export * from "./agents/bug-fix-attempt-repository";
export * from "./agents/backlog-drain-repository";
export * from "./agents/backlog-drain-selection";

// ── ai ──
export * from "./ai/ai-session-repository";
export * from "./ai/ai-conversation-repository";
export * from "./ai/ask-index-repository";
export * from "./ai/suggested-docs-repository";

// ── connections ──
export * from "./connections/connection-repository";
export * from "./connections/oauth-states-repository";

// ── integrations ──
export * from "./integrations/repository-repository";
export * from "./integrations/github-repository";
export * from "./integrations/manifest-states-repository";
export * from "./integrations/discord-connection-repository";
export * from "./integrations/telegram-repository";
export * from "./integrations/telegram-commands-repository";
export * from "./integrations/telegram-notification-settings-repository";

// ── handbook ──
export * from "./handbook-repository";

// ── documents ──
export * from "./documents/document-repository";
export * from "./documents/document-reads-repository";
export * from "./documents/document-favorites-repository";
export * from "./documents/document-version-repository";
export * from "./documents/document-versions";
export * from "./documents/document-category-repository";
export * from "./documents/document-work-items-repository";

// ── feedback ──
export * from "./feedback/feedback-source-repository";
export * from "./feedback/feedback-item-repository";
export * from "./feedback/feedback-cluster-repository";
export * from "./feedback/feedback-triage-repository";
export * from "./feedback/feedback-triage-metrics-repository";
export * from "./feedback/feedback-topic-repository";
export * from "./feedback/feedback-topic-proposal-repository";

// ── billing ──
export * from "./billing/expense-repository";
export * from "./billing/expense-category-repository";
export * from "./billing/currency-rate-repository";
export * from "./billing/recurring-expense-repository";
export * from "./billing/quota-repository";
export * from "./billing/usage-repository";

// ── notifications ──
export * from "./notifications/notification-queue-repository";
export * from "./notifications/notification-repository";
export * from "./notifications/email-notification-repository";
export * from "./notifications/push-subscription-repository";

// ── auth ──
export * from "./auth/api-key-repository";
export * from "./auth/service-account-repository";
export * from "./auth/user-repository";
export * from "./auth/onboarding-repository";

// ── waitlist ──
export * from "./waitlist/waitlist-repository";
export * from "./waitlist/contact-submission-repository";

// ── admin (CE: system settings + instance/tailnet config) ──
export * from "./admin/admin-settings.repository";
export * from "./admin/instance-settings.repository";
export * from "./admin/instance-tailnet-database-access.repository";
export * from "./admin/effort-estimator-config-repository";

// ── observability ──
export * from "./observability/analytics-repository";
export * from "./observability/health-repository";

// ── debug ──
export * from "./debug/incident-bundle-repository";

// ── effort estimation ──
export * from "./work-item-effort-repository";
