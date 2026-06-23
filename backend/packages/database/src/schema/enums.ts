import { pgEnum } from "drizzle-orm/pg-core";

export const webhookTriggerEnum = pgEnum("webhook_trigger", [
  "work_item_created",
  "work_item_updated",
  "work_item_moved",
  "work_item_deleted",
  "comment_added",
  "attachment_added",
  "sprint_closed",
  "milestone_completed",
]);

export const webhookStatusEnum = pgEnum("webhook_status", [
  "pending",
  "success",
  "failed",
]);

export const importStatusEnum = pgEnum("import_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

// Project Management Enums
export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "archived",
  "on_hold",
]);

export const workItemTypeEnum = pgEnum("work_item_type", [
  "epic",
  "feature",
  "story",
  "task",
  "idea",
]);

export const priorityEnum = pgEnum("priority", [
  "low",
  "medium",
  "high",
  "urgent",
]);

export const docLinkTypeEnum = pgEnum("doc_link_type", [
  "notion",
  "github",
  "gdocs",
  "confluence",
  "figma",
  "other",
]);

export const repositoryProviderEnum = pgEnum("repository_provider", [
  "github",
  "gitlab",
  "bitbucket",
  "other",
]);

export const boardAreaEnum = pgEnum("board_area", [
  "desarrollo",
  "ventas",
  "prospeccion",
  "marketing",
  "general",
]);

export const columnRoleEnum = pgEnum("column_role", [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "testing",
  "needs_fix",
  "validating",
  "release",
  "to_document",
  "done",
  "other",
]);

export const documentCategoryStatusEnum = pgEnum("document_category_status", [
  "active",
  "archived",
]);

// GitHub Enums
export const githubAccountTypeEnum = pgEnum("github_account_type", [
  "user",
  "organization",
]);

export const githubPrStateEnum = pgEnum("github_pr_state", [
  "open",
  "closed",
  "merged",
]);

export const githubReviewStatusEnum = pgEnum("github_review_status", [
  "pending",
  "approved",
  "changes_requested",
  "commented",
  "dismissed",
]);

export const githubCiStatusEnum = pgEnum("github_ci_status", [
  "pending",
  "queued",
  "in_progress",
  "success",
  "failure",
  "cancelled",
  "skipped",
  "neutral",
]);

export const githubEventTypeEnum = pgEnum("github_event_type", [
  "push",
  "pull_request",
  "pull_request_review",
  "check_run",
  "workflow_run",
  "installation",
  "deployment",
]);

// Work Item Assignee Enums
export const assigneeRoleEnum = pgEnum("assignee_role", ["responsible", "collaborator", "reviewer"]);

// Work Item Event Enums
export const workItemEventTypeEnum = pgEnum("work_item_event_type", [
  "created",
  "updated",
  "moved",
  "deleted",
  "attachment_added",
  "attachment_removed",
  "ai_session",
  "comment",
]);

export const eventTriggeredByEnum = pgEnum("event_triggered_by", [
  "user",
  "system",
  "claude-code",
  "worker",
  "websocket",
  "api",
  "nightly",
  "mcp",
]);

// Sprint Enums
export const sprintStatusEnum = pgEnum("sprint_status", [
  "open",
  "closed",
]);

// Milestone Enums
export const milestoneStatusEnum = pgEnum("milestone_status", [
  "planned",
  "in_progress",
  "completed",
  "on_hold",
  "cancelled",
]);

// Agent jobs
export const agentJobStatusEnum = pgEnum("agent_job_status", [
  "queued",
  "running",
  "finalizing",
  "completed",
  "incomplete",
  "failed",
  "cancelled",
  "waiting_for_input",
  "paused",
]);

export const agentProviderEnum = pgEnum("agent_provider", [
  "claude-code",
  "codex",
  "zipu",
  "grok",
]);

export const codingAgentEnum = pgEnum("coding_agent", [
  "codex",
  "claude-code",
  "opencode",
]);

export const agentJobTypeEnum = pgEnum("agent_job_type", [
  "implementation",
  "planning",
  "review",
  "validation",
  "recording",
  "prewarm",
  "bug-analysis",
  "bug-fix",
  "scheduled",
  "incident-analyze",
  "feedback-triage",
  "feedback-triage-batch",
  "integration",
]);

export const triggerTypeEnum = pgEnum("trigger_type", [
  "event",
  "scheduled",
  "recovery",
]);

export const bugFixAttemptStatusEnum = pgEnum("bug_fix_attempt_status", [
  "analyzing",
  "proposed",
  "implementing",
  "merged",
  "failed",
]);

export const bugDomainEnum = pgEnum("bug_domain", [
  "frontend",
  "backend",
  "coding-agent",
  "infrastructure",
  "unknown",
]);

export const workerStatusEnum = pgEnum("worker_status", [
  "online",
  "offline",
]);

export const aiProviderEnum = pgEnum("ai_provider", ["anthropic", "openai", "google", "zai", "xai"]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "completed",
  "archived",
]);

// Worker Interaction Enums
export const workerQuestionTypeEnum = pgEnum("worker_question_type", [
  "clarification",
  "approval",
  "choice",
  "free_text",
]);

export const workerInteractionStatusEnum = pgEnum("worker_interaction_status", [
  "pending",
  "answered",
  "timed_out",
  "cancelled",
]);

// Feedback Enums
export const feedbackSourceTypeEnum = pgEnum("feedback_source_type", [
  "widget",
  "api",
  "telegram",
  "email",
  "manual",
]);

export const feedbackStatusEnum = pgEnum("feedback_status", [
  "new",
  "triaged",
  "in_progress",
  "pending_validation",
  "implementing",
  "deployed",
  "verified",
  "cancelled",
]);

export const feedbackCategoryEnum = pgEnum("feedback_category", [
  "bug",
  "feature_request",
  "improvement",
  "question",
  "praise",
  "other",
]);

export const feedbackClusterStatusEnum = pgEnum("feedback_cluster_status", [
  "open",
  "investigating",
  "fix_ready",
  "resolved",
  "regression",
  "dismissed",
  // `promoted` is retained as a legacy/deprecated value — existing rows
  // with this status must continue to be readable. Do NOT remove.
  "promoted",
]);

export const feedbackTopicStatusEnum = pgEnum("feedback_topic_status", [
  "active",
  "archived",
  "merged",
]);

export const feedbackTopicProposalTypeEnum = pgEnum("feedback_topic_proposal_type", [
  "merge",
  "split",
  "rename",
]);

export const feedbackTopicProposalStatusEnum = pgEnum("feedback_topic_proposal_status", [
  "pending",
  "accepted",
  "rejected",
  "failed",
]);

// Planning Session Enums
export const planningSessionStatusEnum = pgEnum("planning_session_status", [
  "active",
  "interrupted",
  "completed",
  "archived",
]);

// Integration Batch Enums
export const integrationBatchStatusEnum = pgEnum("integration_batch_status", [
  "queued",
  "running",
  "awaiting_release",
  "merging",
  "completed",
  "failed",
  "aborted",
]);

export const integrationBatchItemStatusEnum = pgEnum("integration_batch_item_status", [
  "pending",
  "rebasing",
  "migrating",
  "type_checking",
  "testing",
  "merged",
  "skipped",
  "failed",
]);

export const integrationBatchItemFailureCategoryEnum = pgEnum("integration_batch_item_failure_category", [
  "merge_conflict",
  // Deprecated: prefer schema_obsolete_branch (auto-remediable) or
  // schema_irreconcilable (blocks for human decision). Kept for backwards
  // compatibility with batches authored before the split.
  "schema_semantic",
  // Branch was authored against an older schema state; main has been moved
  // forward by another already-approved feature. Auto-remediable: re-run
  // runner-fix-dod against the current schema.
  "schema_obsolete_branch",
  // Two valid schemas for the same domain (no clear winner). Requires a
  // human decision via the structured DodHumanActionV2 panel.
  "schema_irreconcilable",
  "migration_apply_failed",
  "type_check_failed",
  "tests_failed",
]);

// Service Account Enums
export const serviceAccountTypeEnum = pgEnum("service_account_type", ["runner", "integration"]);

// Seed Enums
export const seedStatusEnum = pgEnum("seed_status", [
  "draft",
  "active",
  "to_review",
  "approved",
  "archived",
  "rejected",
]);

export const seedSourceEnum = pgEnum("seed_source", [
  "manual",
  "feedback",
  "ai_generated",
  "import",
]);

// Entity Comments Enums
export const entityTypeEnum = pgEnum("entity_type", ["idea", "todo", "work_item", "seed", "feedback_item"]);

// Todo Items Enums
export const todoItemStatusEnum = pgEnum("todo_item_status", [
  "pending",
  "in_progress",
  "done",
  "blocked",
]);

// Ideas Hub Enums
export const ideaItemTypeEnum = pgEnum("idea_item_type", ["idea", "seed"]);

export const ideaItemStatusEnum = pgEnum("idea_item_status", [
  "draft",
  "active",
  "to_review",
  "approved",
  "archived",
  "rejected",
  "pending",
  "done",
  "blocked",
]);

export const ideaItemWorkLinkTypeEnum = pgEnum("idea_item_work_link_type", [
  "promoted_to",
  "related_to",
]);

// Quota Enums
export const quotaTypeEnum = pgEnum("quota_type", [
  "daily",
  "weekly",
  "monthly",
]);

export const quotaAlertTypeEnum = pgEnum("quota_alert_type", [
  "warning_75",
  "warning_80",
  "warning_90",
  "exceeded",
]);

// Contact Enums
export const contactReasonEnum = pgEnum("contact_reason", [
  "general",
  "support",
  "partnership",
  "feedback",
  "other",
]);

export const contactStatusEnum = pgEnum("contact_status", [
  "new",
  "read",
  "responded",
  "archived",
]);

// Waitlist Enums
export const waitlistUserStatusEnum = pgEnum("waitlist_user_status", [
  "pending",
  "confirmed",
]);

export const waitlistActionTypeEnum = pgEnum("waitlist_action_type", [
  "email_confirmed",
  "profile_completed",
  "share_x",
  "share_linkedin",
  "referral_confirmed",
  "features_selected",
  "pioneer_payment",
]);

export const waitlistTierEnum = pgEnum("waitlist_tier", [
  "none",
  "early_access",
  "supporter",
  "pioneer",
]);

export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", [
  "sent",
  "delivered",
  "bounced",
  "complained",
]);

export const waitlistEmailTokenTypeEnum = pgEnum("waitlist_email_token_type", [
  "confirm_email",
]);

// Provider Connections Enums
export const providerTypeEnum = pgEnum("provider_type", [
  "github",
  "openai",
  "anthropic",
  "google",
  "zai",
  "xai",
  "vercel",
  "sentry",
  "posthog",
]);

export const connectionCategoryEnum = pgEnum("connection_category", [
  "code",
  "ai",
  "deployment",
  "monitoring",
]);

export const connectionScopeEnum = pgEnum("connection_scope", [
  "user",
  "organization",
  "instance",
]);

export const aiKeyPolicyEnum = pgEnum("ai_key_policy", [
  "org_only",
  "org_preferred",
  "user_preferred",
  "user_only",
]);

export const orchestrationStrategyEnum = pgEnum("orchestration_strategy", [
  "round_robin",
  "sequential",
  "reset_first",
]);

// Worker Lifecycle Event Enums
export const workerLifecycleEventTypeEnum = pgEnum("worker_lifecycle_event_type", [
  "started",
  "stopped",
  "ip_changed",
  "draining_started",
  "draining_stopped",
]);

// Notification Queue Enums
export const notificationTypeEnum = pgEnum("notification_type", ["assignment", "comment", "mention", "status_changed"]);

// Usage Session Enums
export const usageSessionTypeEnum = pgEnum("usage_session_type", [
  "implement",
  "validate",
  "planning",
  "review",
  "chat",
]);

// Expense Enums
export const expenseStatusEnum = pgEnum("expense_status", ["draft", "pending_approval", "approved", "rejected", "paid", "void"]);
export const invoiceProcessingStatusEnum = pgEnum("invoice_processing_status", ["pending", "processing", "processed", "failed"]);
export const expenseRecurrenceEnum = pgEnum("expense_recurrence", ["weekly", "monthly", "quarterly", "yearly"]);
export const currencyCodeEnum = pgEnum("currency_code", ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD", "MXN", "BRL", "CLP", "COP", "ARS"]);

// Skill Enums
export const skillSourceEnum = pgEnum("skill_source", [
  "official",
  "custom",
  "repo",
]);

// Ask Feature Enums
export const askSourceTypeEnum = pgEnum("ask_source_type", [
  "work_item",
  "document",
  "event",
  "commit",
]);

export const askIngestionStatusEnum = pgEnum("ask_ingestion_status", [
  "idle",
  "running",
  "error",
  "completed",
]);


// Handbook Knowledge Base Enums
export const handbookEntryStatusEnum = pgEnum("handbook_entry_status", [
  "draft",
  "verified",
  "deprecated",
]);

export const handbookEntrySourceTypeEnum = pgEnum("handbook_entry_source_type", [
  "import",
  "agent_capture",
  "manual",
]);

export const handbookCaptureProposalStatusEnum = pgEnum("handbook_capture_proposal_status", [
  "pending",
  "approved",
  "rejected",
]);

// Project Member Enums
export const projectMemberRoleEnum = pgEnum("project_member_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

// Agent Observation Enums
export const observationTypeEnum = pgEnum("observation_type", [
  "decision",
  "architecture",
  "bugfix",
  "pattern",
  "config",
  "discovery",
  "learning",
  "error_diagnosis",
  "work_item",
  "todo_item",
  "seed",
]);

export const memoryVisibilityEnum = pgEnum("memory_visibility", [
  "personal",
  "project",
  "org",
]);

export const memoryCreatedByKindEnum = pgEnum("memory_created_by_kind", [
  "agent",
  "human",
  "system",
]);

export const memoryTelemetryEventEnum = pgEnum("memory_telemetry_event", [
  "search",
  "context",
  "save",
  "inject",
]);
