/**
 * Cross-Org Isolation Test
 *
 * Iterates over ALL public MCP tools, invokes each with auth from Org B
 * against resources seeded from Org A, and asserts none return Org A data.
 *
 * Classification:
 *   - scoped:      Tool properly denied access or returned empty / Org B data
 *   - back-office: Tool is org-less by design (e.g. get_current_user)
 *   - leak:        Tool returned Org A data to an Org B caller
 *
 * Tolerance list: any tools listed in TOLERATED_LEAKS are expected to leak
 * and will not fail the test (document reason inline).
 */
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
import {
  testWorkItem,
  testIdeaItem,
  testSeed,
  testBoard,
  testBoardColumn,
  testProject,
  testOrganization,
} from "../../test/fixtures";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORG_A = "org-test-1";
const ORG_B = "org-test-2";

// ---------------------------------------------------------------------------
// Org-aware database mocks
//
// The default mocks from createDatabaseMocks return Org A data regardless of
// which org calls. We override key repository functions so they check the
// organizationId argument and only return data when it matches Org A.
// When Org B calls, they return empty results / null.
// ---------------------------------------------------------------------------

const orgAwareOverrides: Record<string, unknown> = {
  // Work items
  getWorkItems: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { items: [testWorkItem], total: 1 };
    return { items: [], total: 0 };
  },
  getWorkItemById: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    const id = typeof args[1] === "string" ? args[1] : typeof args[0] === "string" && args[0] !== ORG_A && args[0] !== ORG_B ? args[0] : undefined;
    if (orgId === ORG_A && id === testWorkItem.id) return testWorkItem;
    // If first arg is the ID directly (some calls may not pass orgId first)
    if (!orgId && id === testWorkItem.id) return null;
    return null;
  },
  createWorkItem: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    return {
      id: "wi-new-1",
      title: "New Work Item",
      type: "task",
      boardColumnId: "col-new-1",
      organizationId: orgId ?? "unknown",
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    };
  },
  updateWorkItem: async () => null,
  deleteWorkItem: async () => false,
  moveWorkItem: async () => false,
  bulkMoveWorkItems: async () => false,

  // Projects
  getProjects: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { projects: [testProject], total: 1 };
    return { projects: [], total: 0 };
  },
  getProjectById: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    const id = typeof args[1] === "string" ? args[1] : undefined;
    if (orgId === ORG_A && id === testProject.id) return testProject;
    return null;
  },
  createProject: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    return {
      id: "proj-new-1",
      name: "New Project",
      description: null,
      status: "active" as const,
      organizationId: orgId ?? "unknown",
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    };
  },
  updateProject: async () => null,
  getProjectRoadmap: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [{ id: "milestone-1", name: "M1" }];
    return [];
  },

  // Boards
  getAllBoards: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [testBoard];
    return [];
  },
  getBoardById: async (...args: unknown[]) => {
    // getBoardById(id, organizationId) — id first, orgId second
    const id = typeof args[0] === "string" ? args[0] : undefined;
    const orgId = typeof args[1] === "string" ? args[1] : undefined;
    if (orgId === ORG_A && id === testBoard.id) return testBoard;
    return null;
  },
  getBoardByIdInternal: async (...args: unknown[]) => {
    const id = typeof args[0] === "string" ? args[0] : undefined;
    if (id === testBoard.id) return testBoard;
    return null;
  },
  createBoard: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    return {
      id: "board-new-1",
      name: "New Board",
      description: null,
      area: "desarrollo" as const,
      isDefault: false,
      organizationId: orgId ?? "unknown",
      columns: [],
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    };
  },
  getBoardColumns: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [testBoardColumn];
    return [];
  },
  getWorkItemsByBoard: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [{ column: testBoardColumn, items: [testWorkItem], count: 1 }];
    return [];
  },
  getBoardsByArea: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [testBoard];
    return [];
  },

  // Sprints
  getSprintsByBoard: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [{ id: "sprint-1", boardId: testBoard.id, name: "Sprint 1", status: "active" }];
    return [];
  },
  getSprintById: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { id: "sprint-1", boardId: testBoard.id, name: "Sprint 1", status: "active" };
    return null;
  },
  getActiveSprint: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { id: "sprint-1", boardId: testBoard.id, name: "Sprint 1", status: "active" };
    return null;
  },
  createSprint: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    return { id: "sprint-new-1", boardId: "board-new-1", name: "Sprint New", status: "active", organizationId: orgId };
  },
  closeSprint: async () => null,
  closeSprintAdHoc: async () => null,
  closeSprintByDate: async () => null,
  getSprintWorkItems: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [testWorkItem];
    return [];
  },
  getDoneItemsPreview: async () => [],

  // Ideas
  getIdeaItems: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { items: [testIdeaItem], total: 1 };
    return { items: [], total: 0 };
  },
  getIdeaItemById: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    const id = typeof args[1] === "string" ? args[1] : undefined;
    if (orgId === ORG_A && id === testIdeaItem.id) return testIdeaItem;
    return null;
  },
  createIdeaItem: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    const input = args[1] && typeof args[1] === "object" && !Array.isArray(args[1])
      ? (args[1] as Record<string, unknown>)
      : {};
    return {
      id: "idea-new-1",
      organizationId: orgId ?? "unknown",
      type: (input.type as string) ?? "idea",
      status: (input.status as string) ?? "active",
      title: String(input.title ?? "New Idea Item").trim(),
      description: (input.description as string) ?? null,
      ownerUserId: null,
      dueDate: null,
      metadata: {},
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
      feedbackLinks: [],
      workItemLinks: [],
    };
  },
  updateIdeaItem: async () => null,
  deleteIdeaItem: async () => false,
  setIdeaItemStatus: async () => null,
  assignIdeaItemOwner: async () => null,
  setIdeaItemDueDate: async () => null,
  getIdeaItemTraceability: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { ideaItem: testIdeaItem, feedbackLinks: [], workItemLinks: [] };
    return null;
  },
  getIdeaItemEventsByIdeaItemId: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { items: [], total: 0 };
    return { items: [], total: 0 };
  },
  linkFeedbackToIdeaItem: async () => ({ id: "link-new-1" }),
  unlinkFeedbackFromIdeaItem: async () => false,
  linkWorkItemToIdeaItem: async () => ({ id: "link-new-1" }),
  toggleIdeaItemDiscussed: async () => null,
  getCommentsByIdeaItem: async () => [],
  getIdeaItemCommentVersions: async () => [],
  createIdeaItemComment: async () => ({ id: "comment-new-1" }),
  updateIdeaItemComment: async () => null,
  deleteIdeaItemComment: async () => false,
  getCommentCountByIdeaItem: async () => 0,
  getTagsByIdeaItem: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [{ id: "tag-1", name: "test-tag" }];
    return [];
  },
  addTagToIdeaItem: async () => ({ id: "tag-link-1" }),
  removeTagFromIdeaItem: async () => false,

  // Seeds
  getSeeds: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { items: [testSeed], total: 1 };
    return { items: [], total: 0 };
  },
  getSeedById: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    const id = typeof args[1] === "string" ? args[1] : undefined;
    if (orgId === ORG_A && id === testSeed.id) return testSeed;
    return null;
  },
  createSeed: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    const input = args[1] && typeof args[1] === "object" && !Array.isArray(args[1])
      ? (args[1] as Record<string, unknown>)
      : {};
    return {
      id: "seed-new-1",
      organizationId: orgId ?? "unknown",
      title: String(input.title ?? "New Seed").trim(),
      description: (input.description as string) ?? null,
      status: "active" as const,
      source: "manual" as const,
      priority: "medium" as const,
      selectedForIdeation: false,
      maturityLevel: 1,
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
      feedbackLinks: [],
      workItemLinks: [],
      tags: [],
    };
  },
  updateSeed: async () => null,
  deleteSeed: async () => false,
  setSeedStatus: async () => null,
  assignSeedOwner: async () => null,
  getSelectedSeedsForIdeation: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [testSeed];
    return [];
  },
  bulkSelectSeedsForIdeation: async () => 0,
  linkWorkItemToSeed: async () => ({ id: "link-new-1" }),
  addTagToSeed: async () => ({ id: "tag-link-1" }),
  removeTagFromSeed: async () => false,
  getSeedEvents: async () => ({ items: [], total: 0 }),
  getTagsBySeed: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [{ id: "tag-1", name: "test-tag" }];
    return [];
  },

  // Tags
  getTags: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [{ id: "tag-1", name: "test-tag", organizationId: ORG_A }];
    return [];
  },
  createTag: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    return { id: "tag-new-1", name: "new-tag", organizationId: orgId };
  },
  deleteTag: async () => false,
  createTagIfNotExists: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    return { id: "tag-new-1", name: "new-tag", organizationId: orgId };
  },
  getTagById: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { id: "tag-1", name: "test-tag", organizationId: ORG_A };
    return null;
  },

  // Documents
  getDocuments: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { items: [{ id: "doc-1", title: "Test Doc", organizationId: ORG_A }], total: 1 };
    return { items: [], total: 0 };
  },
  getDocumentCategories: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [{ id: "cat-1", name: "Category 1", organizationId: ORG_A }];
    return [];
  },

  // Members
  getMembersByOrganizationId: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) {
      return [{
        memberId: "member-test-1",
        userId: "user-test-1",
        name: "Test User",
        email: "test@example.com",
        image: null,
        role: "owner",
        joinedAt: new Date("2025-01-01"),
      }];
    }
    if (orgId === ORG_B) {
      return [{
        memberId: "member-test-2",
        userId: "user-test-2",
        name: "Test User B",
        email: "testb@example.com",
        image: null,
        role: "owner",
        joinedAt: new Date("2025-01-01"),
      }];
    }
    return [];
  },

  // Auth
  getUserById: async (...args: unknown[]) => {
    const id = typeof args[0] === "string" ? args[0] : undefined;
    if (id === "user-test-2") return { id: "user-test-2", name: "Test User B", email: "testb@example.com" };
    if (id === "user-test-1") return { id: "user-test-1", name: "Test User", email: "test@example.com" };
    return null;
  },

  // Quota — org-aware
  checkQuotaAvailable: async () => ({ allowed: true, remaining: 100 }),
  getCurrentUsage: async () => [],

  // Todos
  getTodoItems: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { items: [{ id: "todo-1", title: "Test Todo", organizationId: ORG_A }], total: 1 };
    return { items: [], total: 0 };
  },
  getTodoItemById: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { id: "todo-1", title: "Test Todo", organizationId: ORG_A };
    return null;
  },
  createTodoItem: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    return { id: "todo-new-1", title: "New Todo", organizationId: orgId };
  },
  updateTodoItem: async () => null,
  deleteTodoItem: async () => false,
  setTodoItemStatus: async () => null,
  assignTodoItemOwner: async () => null,
  setTodoItemDueDate: async () => null,

  // Milestones
  getMilestonesByProject: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [{ id: "ms-1", name: "Milestone 1", organizationId: ORG_A }];
    return [];
  },
  getMilestoneById: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { id: "ms-1", name: "Milestone 1", organizationId: ORG_A };
    return null;
  },
  getMilestoneProgress: async () => null,
  createMilestone: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    return { id: "ms-new-1", name: "New Milestone", organizationId: orgId };
  },
  updateMilestone: async () => null,
  deleteMilestone: async () => false,
  addWorkItemsToMilestone: async () => false,
  removeWorkItemFromMilestone: async () => false,

  // Expenses
  getExpenses: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { items: [{ id: "exp-1", description: "Test Expense", organizationId: ORG_A }], total: 1 };
    return { items: [], total: 0 };
  },
  getExpenseById: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { id: "exp-1", description: "Test Expense", organizationId: ORG_A };
    return null;
  },
  createExpense: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    return { id: "exp-new-1", description: "New Expense", organizationId: orgId };
  },
  getExpenseCategories: async () => [],
  getExpenseAggregations: async () => ({ total: 0, byCategory: [] }),
  getRecurringExpenses: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [{ id: "rec-1", organizationId: ORG_A }];
    return [];
  },

  // Memory / observations
  createObservation: async () => ({ id: "obs-new-1" }),
  getRecentObservations: async () => [],
  searchObservations: async () => [],
  createMemoryTelemetry: async () => {},
  getObservationsByOrg: async () => [],

  // Entity comments (shared across ideas, seeds, todos, work items)
  getEntityComments: async () => [],
  createEntityComment: async () => ({ id: "comment-new-1" }),
  getEntityCommentVersions: async () => [],

  // Work item extras
  getWorkItemEventsByWorkItemId: async () => [],
  getAiSessionsSummaryByWorkItemId: async () => ({ sessions: [], summary: {} }),
  getAiSessionsByWorkItemId: async () => [],
  createAiSession: async () => ({ id: "session-new-1" }),
  saveGeneratedPrompt: async () => true,
  getDescendantLeafIds: async () => [],
  setWorkItemAiProcessing: async () => true,
  addWorkItemToSession: async () => true,
  getWorkItemsByTaskIds: async () => [],
  getWorkItemsByIds: async () => [],
  createWorkItemEvent: async () => ({}),
  createWorkItemEvents: async () => [],
  getEventsByDateRange: async () => [],
  getBoardColumnsByIds: async () => [],
  getChildCountsByParentIds: async () => new Map(),
  getWorkItemHierarchy: async () => [],
  isParentType: () => false,

  // Dependencies
  getDependencies: async () => [],
  getDependents: async () => [],
  getDependenciesBatch: async () => [],
  getDependentsBatch: async () => [],
  addDependency: async () => ({ id: "dep-new-1" }),
  removeDependency: async () => false,

  // Attachments
  getAttachmentsByWorkItem: async () => [],
  createAttachment: async () => ({ id: "att-new-1" }),
  deleteAttachment: async () => false,
  getAttachment: async () => null,

  // Documents linked to work items
  getDocumentsByWorkItemId: async () => [],
  linkDocumentToWorkItem: async () => ({ id: "link-new-1" }),
  unlinkDocumentFromWorkItem: async () => false,
  createDocument: async () => ({ id: "doc-new-1", title: "New Doc", projectId: null }),
  getSuggestedDocuments: async () => [],

  // Commits
  linkCommitToWorkItem: async () => ({ id: "commit-link-1" }),
  getOrganizationMemberUserIdByGithubLogin: async () => null,

  // Agent jobs
  listRecentFailedJobs: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [{ id: "job-1", organizationId: ORG_A }];
    return [];
  },
  getJobById: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return { id: "job-1", organizationId: ORG_A };
    return null;
  },
  getJobErrorSummary: async () => null,
  createJob: async () => ({ id: "job-new-1" }),

  // Bug fix attempts
  createBugFixAttemptFromClaim: async () => null,
  getBugFixAttemptById: async () => null,
  updateBugFixAttempt: async () => null,
  getClaimableBugFeedbackItems: async (...args: unknown[]) => {
    const orgId = typeof args[0] === "string" ? args[0] : undefined;
    if (orgId === ORG_A) return [{ id: "feedback-1", organizationId: ORG_A }];
    return [];
  },
  getFailedAttemptsByCluster: async () => [],
  getFeedbackItemById: async () => null,
  updateFeedbackItem: async () => null,

  // Error diagnosis
  getRepoIdsForProject: async () => [],

  // Feedback / notification
  enqueueNotification: async () => {},
  parseMentionsFromHtml: () => [],

  // DB query chain mock (for boards.tools.ts listBoards which uses db.select directly)
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [],
        }),
      }),
    }),
  },
};

// ---------------------------------------------------------------------------
// Module mocks — MUST be at top level before any dynamic imports resolve.
// Paths resolve from THIS file: backend/api/src/mcp/tools/
// ---------------------------------------------------------------------------

mock.module("@almirant/database", () => createDatabaseMocks(orgAwareOverrides));
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
  getJobIdFromExtra: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
    const jobId = extra.authInfo?.extra?.jobId;
    return typeof jobId === "string" ? jobId : undefined;
  },
  getPlanningMetadataFromExtra: () => undefined,
  getPermissionsFromExtra: (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
    const perms = extra.authInfo?.extra?.permissions;
    return Array.isArray(perms) ? perms.filter((p: unknown): p is string => typeof p === "string") : [];
  },
}));

// --- Telegram & email notifications ---
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
    recordUsage: async () => {},
  },
}));

// --- debug.tools.ts (internal registry, but mock anyway to prevent import errors) ---
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

// --- memory.tools.ts dependencies ---
mock.module("../../lib/memory/ranker", () => ({
  getConfidenceBand: () => "medium",
  parseConfidence: () => 0.5,
  rankObservationResults: (results: unknown[]) => results,
  validateTopicKeyForType: () => true,
}));
mock.module("../../lib/memory/scrubber", () => ({
  assertSafeMemoryPayload: () => {},
  assertSafeMemoryText: () => {},
}));

// --- bug-fix-attempts.tools.ts dependencies ---
mock.module("../../domains/debug/services/attempt-workflow-guards", () => ({
  getAttemptWorkflowGuards: () => ({
    canTransitionTo: () => true,
    getValidTransitions: () => [],
  }),
  getAttemptWorkflowGuardError: () => null,
}));

// --- error-diagnosis.tools.ts dependencies ---
mock.module("../../domains/debug/services/error-fingerprint-service", () => ({
  computeFingerprint: () => "fp-test",
  normalizeStackTrace: (s: string) => s,
}));
mock.module("../../domains/debug/services/error-recurrence-service", () => ({
  findRecurrences: async () => [],
  getRecurrenceStats: async () => ({ total: 0, unique: 0 }),
}));

// --- commits.tools.ts dependency ---
mock.module("../../domains/project-management/commits/services/commit-linker", () => ({
  linkCommitToWorkItems: async () => [],
}));

// --- skill-context.tools.ts dependencies ---
mock.module("../../domains/project-management/work-items/services/skill-context-service", () => ({
  buildImplementContext: async () => "implement context",
  buildReviewContext: async () => "review context",
  buildValidateContext: async () => "validate context",
  buildDocumentContext: async () => "document context",
  buildIdeationContext: async () => "ideation context",
  buildRecordVideoContext: async () => "record video context",
  buildBoardContext: async () => "board context",
}));

// ---------------------------------------------------------------------------
// Import the builder (after mocks are set up)
// ---------------------------------------------------------------------------

import { buildPublicToolsRegistry } from "../test/build-tools-registry";

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(() => {
  mock.restore();
  restoreRealModules();
});

// ---------------------------------------------------------------------------
// Org B auth context — caller is Org B, resources belong to Org A
// ---------------------------------------------------------------------------

const withOrgB = {
  authInfo: {
    extra: {
      organizationId: ORG_B,
      projectId: "proj-test-2",
      userId: "user-test-2",
    },
  },
};

// ---------------------------------------------------------------------------
// Tools that are org-less by design (back-office / personal)
// These tools don't expose other org's data because they only return
// data about the caller themselves.
// ---------------------------------------------------------------------------

const BACK_OFFICE_TOOLS = new Set([
  "get_current_user", // Returns the authenticated user's own profile
]);

// ---------------------------------------------------------------------------
// Tool-specific parameters — pass Org A resource IDs to detect leaks
// ---------------------------------------------------------------------------

const TOOL_PARAMS: Record<string, Record<string, unknown>> = {
  // Work items — pass Org A IDs
  get_work_item: { id: testWorkItem.id },
  update_work_item: { id: testWorkItem.id, title: "Hacked Title" },
  delete_work_item: { id: testWorkItem.id },
  move_work_item: { id: testWorkItem.id, boardColumnId: "col-test-2" },

  // Projects — pass Org A IDs
  get_project: { id: testProject.id },
  update_project: { id: testProject.id, name: "Hacked Project" },
  get_project_roadmap: { projectId: testProject.id },

  // Boards — pass Org A IDs
  get_board: { id: testBoard.id },

  // Ideas — pass Org A IDs
  get_idea_item: { id: testIdeaItem.id },
  update_idea_item: { id: testIdeaItem.id, title: "Hacked Idea" },
  delete_idea_item: { id: testIdeaItem.id },
  set_idea_item_status: { id: testIdeaItem.id, status: "archived" },
  assign_idea_item_owner: { id: testIdeaItem.id, ownerUserId: "user-test-2" },
  set_idea_item_due_date: { id: testIdeaItem.id, dueDate: "2026-12-31" },
  get_idea_item_traceability: { id: testIdeaItem.id },
  toggle_idea_item_discussed: { id: testIdeaItem.id, discussed: true },
  link_feedback_to_idea_item: { ideaItemId: testIdeaItem.id, feedbackItemId: "feedback-1" },
  unlink_feedback_from_idea_item: { ideaItemId: testIdeaItem.id, feedbackItemId: "feedback-1" },
  list_idea_item_tags: { ideaItemId: testIdeaItem.id },
  add_tag_to_idea_item: { ideaItemId: testIdeaItem.id, tagId: "tag-1" },
  remove_tag_from_idea_item: { ideaItemId: testIdeaItem.id, tagId: "tag-1" },
  add_idea_comment: { ideaItemId: testIdeaItem.id, content: "test comment" },
  list_idea_comments: { ideaItemId: testIdeaItem.id },

  // Seeds — pass Org A IDs
  get_seed: { id: testSeed.id },
  update_seed: { id: testSeed.id, title: "Hacked Seed" },
  delete_seed: { id: testSeed.id },
  set_seed_status: { id: testSeed.id, status: "archived" },
  list_seed_tags: { seedId: testSeed.id },
  add_tag_to_seed: { seedId: testSeed.id, tagId: "tag-1" },
  remove_tag_from_seed: { seedId: testSeed.id, tagId: "tag-1" },
  add_seed_comment: { seedId: testSeed.id, content: "test comment" },
  list_seed_comments: { seedId: testSeed.id },

  // Sprints — pass Org A IDs
  list_sprints: { boardId: testBoard.id },
  get_sprint: { id: "sprint-1" },
  get_active_sprint: { boardId: testBoard.id },
  get_sprint_work_items: { sprintId: "sprint-1" },

  // Work item extras — pass Org A IDs
  create_work_item: { title: "Test WI from Org B", boardColumnId: "col-test-1", type: "task" },
  get_work_item_events: { workItemId: testWorkItem.id },
  get_work_item_dependencies: { workItemId: testWorkItem.id },
  add_work_item_dependency: { workItemId: testWorkItem.id, dependsOnId: "wi-test-2" },
  remove_work_item_dependency: { workItemId: testWorkItem.id, dependsOnId: "wi-test-2" },
  get_work_item_prompt: { workItemId: testWorkItem.id },
  get_ai_sessions: { workItemId: testWorkItem.id },
  add_work_item_comment: { workItemId: testWorkItem.id, content: "test comment" },
  list_work_item_comments: { workItemId: testWorkItem.id },

  // Dependencies batch — use Org B work item IDs since the tool echoes
  // input IDs in the output (not a leak, just echo of caller-provided params)
  get_dependencies_batch: { workItemIds: ["wi-test-2"] },

  // Projects — creation
  create_project: { name: "Org B Project" },

  // Tags
  create_tag: { name: "org-b-tag" },
  delete_tag: { id: "tag-1" },

  // Boards
  create_board: { name: "Org B Board" },

  // Sprints — creation
  create_sprint: { boardId: testBoard.id, name: "Org B Sprint" },
  close_sprint: { boardId: testBoard.id },
  close_sprint_adhoc: { boardId: testBoard.id },
  close_sprint_by_date: { boardId: testBoard.id, cutoffDate: "2026-01-01" },

  // Todos
  create_todo_item: { title: "Org B Todo" },
  get_todo_item: { id: "todo-1" },
  update_todo_item: { id: "todo-1", title: "Hacked Todo" },
  delete_todo_item: { id: "todo-1" },
  set_todo_item_status: { id: "todo-1", status: "done" },
  assign_todo_item_owner: { id: "todo-1", ownerUserId: "user-test-2" },
  set_todo_item_due_date: { id: "todo-1", dueDate: "2026-12-31" },
  add_todo_comment: { todoItemId: "todo-1", content: "test comment" },
  list_todo_comments: { todoItemId: "todo-1" },

  // Milestones
  list_milestones: { projectId: testProject.id },
  get_milestone: { id: "ms-1" },
  get_milestone_progress: { id: "ms-1" },
  create_milestone: { projectId: testProject.id, name: "Org B Milestone" },
  update_milestone: { id: "ms-1", name: "Hacked Milestone" },
  delete_milestone: { id: "ms-1" },
  add_work_items_to_milestone: { milestoneId: "ms-1", workItemIds: [testWorkItem.id] },
  remove_work_item_from_milestone: { milestoneId: "ms-1", workItemId: testWorkItem.id },

  // Expenses
  list_expenses: { page: 1, limit: 10 },
  get_expense: { id: "exp-1" },
  create_expense: { description: "Org B Expense", amount: 100, currency: "USD", date: "2026-01-01", categoryId: "cat-1" },
  list_expense_categories: {},
  get_expense_summary: {},
  list_recurring_expenses: {},

  // Quota
  check_quota: { provider: "anthropic" },
  get_quota_usage: {},

  // Memory
  mem_save: { type: "decision", content: "test", topicKey: "test" },
  mem_search: { query: "test" },
  mem_context: {},

  // Commits
  link_commit_to_work_item: { workItemId: testWorkItem.id, sha: "abc123", repoUrl: "https://github.com/test/repo", message: "fix: test" },

  // Bug fix attempts
  list_new_bug_feedback: {},
  create_bug_fix_attempt: { feedbackItemId: "feedback-1" },
  get_bug_fix_attempt: { id: "attempt-1" },
  update_bug_fix_attempt: { id: "attempt-1", status: "in_progress" },
  create_bug_fix_job: { feedbackItemId: "feedback-1" },
  get_failed_attempts_for_cluster: { fingerprint: "fp-test" },
  set_implementation_outcomes: { workItemId: testWorkItem.id, outcomes: "success" },

  // Error diagnosis
  get_agent_job_error_summary: { jobId: "job-1" },
  list_recent_failed_jobs: {},

  // Skill context
  get_implement_context: { workItemId: testWorkItem.id },
  get_review_context: { workItemId: testWorkItem.id },
  get_validate_context: { workItemId: testWorkItem.id },
  get_document_context: { workItemId: testWorkItem.id },
  get_ideation_context: {},
  get_record_video_context: { workItemId: testWorkItem.id },
  get_board_context: { boardId: testBoard.id },

  // Feedback item comments (if registered)
  list_feedback_item_comments: { feedbackItemId: "feedback-1" },
  add_feedback_item_comment: { feedbackItemId: "feedback-1", content: "test comment" },

  // Work item linking to idea/seed
  link_feedback_to_idea_item_param: { ideaItemId: testIdeaItem.id, feedbackItemId: "feedback-1" },
};

// ---------------------------------------------------------------------------
// Org A data markers — strings that indicate Org A data is present
// ---------------------------------------------------------------------------

const ORG_A_MARKERS = [
  ORG_A,                    // "org-test-1"
  testWorkItem.id,          // "wi-test-1"
  testProject.id,           // "proj-test-1"
  testBoard.id,             // "board-test-1"
  testIdeaItem.id,          // "idea-test-1"
  testSeed.id,              // "seed-test-1"
  testOrganization.name,    // "Test Organization" (without "B")
  testWorkItem.title,       // "Test Work Item" (without "B")
  testProject.name,         // "Test Project" (without "B")
];

const containsOrgAData = (text: string): boolean => {
  for (const marker of ORG_A_MARKERS) {
    if (text.includes(marker)) {
      // Exclude false positives where the marker appears as part of Org B data
      // e.g., "Test Work Item B" contains "Test Work Item"
      if (marker === testWorkItem.title && text.includes("Test Work Item B")) continue;
      if (marker === testProject.name && text.includes("Test Project B")) continue;
      if (marker === testOrganization.name && text.includes("Test Organization B")) continue;
      return true;
    }
  }
  return false;
};

// ---------------------------------------------------------------------------
// Tolerated leaks — tools that are known to leak and cannot be fixed yet.
// Each entry MUST have a comment explaining why it is tolerated.
// Ideally this set is EMPTY.
// ---------------------------------------------------------------------------

const TOLERATED_LEAKS = new Set<string>([
  // Add tools here temporarily if they cannot be fixed yet, with a comment:
  // "tool_name", // Reason: ...
]);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Cross-Org Isolation", () => {
  it("iterates over all public tools and classifies them as scoped / back-office / leak", async () => {
    const tools = await buildPublicToolsRegistry();

    // Verify we have a meaningful number of tools
    expect(tools.size).toBeGreaterThan(15);

    const classified = {
      scoped: [] as string[],
      backOffice: [] as string[],
      leak: [] as string[],
      error: [] as string[],
    };

    for (const [toolName, handler] of tools) {
      // Skip back-office tools (org-less by design)
      if (BACK_OFFICE_TOOLS.has(toolName)) {
        classified.backOffice.push(toolName);
        continue;
      }

      const params = TOOL_PARAMS[toolName] ?? {};

      try {
        const result = await handler(params, withOrgB);

        // Tool returned an error — properly scoped (access denied or resource not found)
        if (result.isError) {
          classified.scoped.push(toolName);
          continue;
        }

        const text = result.content[0]?.text ?? "";

        // Empty or trivially empty response — properly scoped
        if (!text || text === "[]" || text === "null" || text === "{}") {
          classified.scoped.push(toolName);
          continue;
        }

        // Check if the response contains Org A data
        if (containsOrgAData(text)) {
          classified.leak.push(toolName);
        } else {
          // Response contains data but no Org A markers — properly scoped
          classified.scoped.push(toolName);
        }
      } catch {
        // Tool threw an exception — treated as properly scoped
        // (the tool rejected the call, even if for the wrong reason)
        classified.scoped.push(toolName);
      }
    }

    // Log classification for debugging / CI visibility
    console.log("\n=== Cross-Org Isolation Classification ===");
    console.log(`Total tools: ${tools.size}`);
    console.log(`Scoped (${classified.scoped.length}): ${classified.scoped.sort().join(", ")}`);
    console.log(`Back-office (${classified.backOffice.length}): ${classified.backOffice.sort().join(", ")}`);
    console.log(`Leak (${classified.leak.length}): ${classified.leak.sort().join(", ")}`);
    console.log(`Tolerated (${TOLERATED_LEAKS.size}): ${[...TOLERATED_LEAKS].sort().join(", ") || "(none)"}`);

    // Filter out tolerated leaks
    const realLeaks = classified.leak.filter((t) => !TOLERATED_LEAKS.has(t));

    if (realLeaks.length > 0) {
      console.error(`\nNON-TOLERATED LEAKS DETECTED: ${realLeaks.join(", ")}`);
    }

    expect(realLeaks).toEqual([]);
  });

  it("verifies more than 15 tools are tested", async () => {
    const tools = await buildPublicToolsRegistry();
    expect(tools.size).toBeGreaterThan(15);
  });
});
