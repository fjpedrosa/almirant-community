import { afterAll, describe, expect, it, mock } from "bun:test";
import {
  createDatabaseMocks,
  createWsMock,
  createLoggerMock,
  createTelegramMock,
  createSprintReportMock,
  createAiServiceMock,
  createAiPricingMock,
  createS3Mock,
  createLocalAttachmentsMock,
  createPromptContextMock,
  restoreRealModules,
} from "../../test/mocks";

// ---------------------------------------------------------------------------
// Module mocks — MUST be at top level before any dynamic imports resolve.
// Paths are relative from the CONSUMING tool files (backend/api/src/mcp/tools/)
// but Bun resolves mock.module paths relative to the CALLING file.
//
// Since mock.module resolves the specifier against the file that calls it,
// relative paths here resolve from backend/api/src/mcp/test/.
// For package aliases (@almirant/*), resolution is global.
// ---------------------------------------------------------------------------

// --- Core package mocks ---
mock.module("@almirant/database", () => createDatabaseMocks());
mock.module("@almirant/config", () => createLoggerMock());

// --- WebSocket ---
mock.module("../../shared/ws/ws-connection-manager", () => createWsMock());
mock.module("../../shared/ws/feedback-events", () => ({
  resolveFeedbackOrganizationId: () => null,
  broadcastFeedbackItemCreated: () => {},
  broadcastFeedbackItemUpdated: () => {},
  broadcastFeedbackItemDeleted: () => {},
  broadcastFeedbackCommentCreated: () => {},
  broadcastFeedbackCommentUpdated: () => {},
  broadcastFeedbackCommentDeleted: () => {},
}));

// --- Setup helpers (used by every tool module via `../setup`) ---
const _getOrganizationIdFromExtra = (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
  const organizationId = extra.authInfo?.extra?.organizationId;
  return typeof organizationId === "string" ? organizationId : undefined;
};

mock.module("../setup", () => ({
  getOrganizationIdFromExtra: _getOrganizationIdFromExtra,
  assertOrgScope: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
    const orgId = _getOrganizationIdFromExtra(extra);
    if (!orgId) {
      return {
        content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }],
        isError: true,
      };
    }
    return orgId;
  },
  getProjectIdFromExtra: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
    const projectId = extra.authInfo?.extra?.projectId;
    return typeof projectId === "string" ? projectId : undefined;
  },
  getManagedByAgentFromExtra: (extra: { authInfo?: { clientId?: string } }) => {
    const clientId = extra.authInfo?.clientId?.toLowerCase();
    if (!clientId) return undefined;
    if (clientId.includes("codex")) return "codex";
    if (clientId.includes("claude")) return "claude-code";
    return undefined;
  },
  getUserIdFromExtra: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
    const userId = extra.authInfo?.extra?.userId;
    return typeof userId === "string" ? userId : undefined;
  },
  getPlanningSessionIdFromExtra: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
    const planningSessionId = extra.authInfo?.extra?.planningSessionId;
    return typeof planningSessionId === "string" ? planningSessionId : undefined;
  },
  getPlanningMetadataFromExtra: () => undefined,
  getJobIdFromExtra: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
    const jobId = extra.authInfo?.extra?.jobId;
    return typeof jobId === "string" ? jobId : undefined;
  },
  getPermissionsFromExtra: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
    const perms = extra.authInfo?.extra?.permissions;
    return Array.isArray(perms) ? perms.filter((p: unknown): p is string => typeof p === "string") : [];
  },
}));

// --- Telegram & email notifications (sprints.tools.ts, work-items.tools.ts) ---
mock.module("../../domains/integrations/telegram/services/telegram/notifications", () =>
  createTelegramMock(),
);
mock.module("../../shared/services/email/notifications", () => ({
  emailNotifySprintClosed: () => {},
  emailNotifyWorkItemAssigned: () => {},
  emailNotifyWorkItemDone: () => {},
  emailNotifyWorkItemMoved: () => {},
  emailNotifyReviewCompleted: () => {},
  emailNotifyUserActions: () => {},
}));

// --- Sprint services ---
mock.module(
  "../../domains/project-management/sprints/services/sprint-visual-report-service",
  () => createSprintReportMock(),
);
mock.module(
  "../../domains/project-management/sprints/services/sprint-changelog-service",
  () => ({
    kickoffSprintChangelogGeneration: () => {},
    generateSprintChangelog: async () => "",
  }),
);

// --- work-items.tools.ts dependencies ---
mock.module(
  "../../domains/project-management/work-items/services/prompt-context-service",
  () => createPromptContextMock(),
);
mock.module("../../domains/ai/shared/services/ai-service", () => createAiServiceMock());
mock.module("../../domains/billing/quota/services/ai-model-pricing", () => createAiPricingMock());
mock.module("../../shared/services/s3-service", () => createS3Mock());
mock.module("../../shared/services/local-attachments", () => createLocalAttachmentsMock());
mock.module("../../domains/connections/services/propagate-provider", () => ({
  propagateProviderToParent: async () => {},
}));
mock.module("../../domains/billing/quota/services/quota-service-instance", () => ({
  quotaService: {
    checkAndConsume: async () => ({ allowed: true }),
    check: async () => ({ allowed: true }),
  },
}));

// --- debug.tools.ts (internal registry) ---
mock.module("../../domains/debug/services/build-incident-bundle", () => ({
  buildIncidentBundle: async () => ({}),
}));
mock.module("../../domains/debug/services/project-incident-timeline", () => ({
  projectIncidentTimeline: async () => [],
}));
mock.module("../../domains/debug/invariants/invariants", () => ({
  runAllInvariants: async () => ({ passed: [], failed: [] }),
}));
mock.module("../../domains/debug/services/set-analysis-status", () => ({
  setAnalysisStatus: async () => {},
}));

// --- agent-jobs.tools.ts ---
mock.module("../../domains/agents/services/agent-job-enrichment", () => ({
  enrichJobWithFingerprint: (job: unknown) => job,
}));

// ---------------------------------------------------------------------------
// Import the builders (after mocks are set up)
// ---------------------------------------------------------------------------

import { buildPublicToolsRegistry } from "./build-tools-registry";

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(() => {
  mock.restore();
  restoreRealModules();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildPublicToolsRegistry", () => {
  it("returns a Map with more than 15 tools", async () => {
    const tools = await buildPublicToolsRegistry();

    expect(tools).toBeInstanceOf(Map);
    expect(tools.size).toBeGreaterThan(15);
  });

  it("contains known public tools", async () => {
    const tools = await buildPublicToolsRegistry();

    const expectedTools = [
      "list_projects",
      "get_work_item",
      "list_idea_items",
      "list_boards",
      "list_sprints",
      "list_documents",
      "create_work_item",
      "get_current_user",
    ];

    for (const toolName of expectedTools) {
      expect(tools.has(toolName)).toBe(true);
    }
  });

  it("every registered handler is a function", async () => {
    const tools = await buildPublicToolsRegistry();

    for (const [_name, handler] of tools) {
      expect(typeof handler).toBe("function");
    }
  });
});
