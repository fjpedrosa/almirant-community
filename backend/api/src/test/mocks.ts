// Shared mock implementations for integration tests.
//
// USAGE: In each test file, use mock.module() at the TOP LEVEL before any imports:
//
//   import { mock } from "bun:test";
//   import { createDatabaseMocks, createWsMock, createResponseMocks } from "../test/mocks";
//
//   mock.module("@almirant/database", () => createDatabaseMocks());
//   mock.module("../shared/ws/ws-connection-manager", () => createWsMock());
//
// IMPORTANT: mock.module() MUST be called at module scope, NOT inside describe/beforeEach.

import {
  testWorkItem,
  testIdeaItem,
  testSeed,
  testBoard,
  testBoardColumn,
  testProject,
  testRepository,
  testWorkspace,
  testIntegrationBatch,
  testIntegrationBatchItem,
} from "./fixtures";
import { testUser } from "./fixtures";
import * as databaseExports from "@almirant/database";
import * as configExports from "@almirant/config";
import * as aiModelPricingExports from "../domains/billing/quota/services/ai-model-pricing";
import * as rankerExports from "../lib/memory/ranker";
import * as scrubberExports from "../lib/memory/scrubber";
import * as agentJobEnrichmentExports from "../domains/agents/services/agent-job-enrichment";
import * as feedbackEventsExports from "../shared/ws/feedback-events";

// ---------------------------------------------------------------------------
// Real module snapshots — captured at import time (before any mock.module).
// Used by restoreRealModules() in afterAll blocks to prevent cross-file
// contamination. Bun's mock.restore() does NOT clear mock.module()
// registrations, so we must re-register the originals explicitly.
// ---------------------------------------------------------------------------
const __realDatabase = { ...databaseExports };
const __realConfig = { ...configExports };
const __realAiModelPricing = { ...aiModelPricingExports };
const __realRanker = { ...rankerExports };
const __realScrubber = { ...scrubberExports };
const __realAgentJobEnrichment = { ...agentJobEnrichmentExports };
const __realFeedbackEvents = { ...feedbackEventsExports };

/**
 * Elysia plugin that injects test user + workspace context.
 * Use: `new Elysia().use(withTestOrg).use(yourRoutes)`
 */
export const withTestOrg = (app: import("elysia").Elysia) =>
  app.derive(() => ({
    user: testUser,
    activeWorkspace: testWorkspace,
    memberRole: "owner" as const,
  }));

const getLastStringArg = (args: unknown[]): string | null => {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    if (typeof args[i] === "string") return args[i] as string;
  }
  return null;
};

const getLastObjectArg = (args: unknown[]): Record<string, unknown> => {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    const candidate = args[i];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return {};
};

/** Default database repository mocks. Override individual functions as needed. */
export const createDatabaseMocks = (overrides: Record<string, unknown> = {}) => ({
  // Keep the original module surface so leaked module mocks don't break unrelated tests.
  ...databaseExports,

  // Work items
  getWorkItems: async () => ({ items: [testWorkItem], total: 1 }),
  getWorkItemById: async (id: string) => (id === testWorkItem.id ? testWorkItem : null),
  createWorkItem: async (...args: unknown[]) => {
    const input = getLastObjectArg(args);
    if (typeof input.boardColumnId === "string" && input.boardColumnId.startsWith("area-")) {
      throw new Error(`BOARD_COLUMN_NOT_FOUND: Column "${input.boardColumnId}" was not found`);
    }
    return { ...testWorkItem, ...input };
  },
  updateWorkItem: async (...args: unknown[]) => {
    const id = getLastStringArg(args);
    return id === testWorkItem.id ? { ...testWorkItem, ...getLastObjectArg(args) } : null;
  },
  deleteWorkItem: async (...args: unknown[]) => getLastStringArg(args) === testWorkItem.id,
  moveWorkItem: async () => true,
  bulkMoveWorkItems: async () => true,
  bulkChangePriority: async () => true,
  changeParent: async () => true,
  setWorkItemAiProcessing: async () => true,
  saveGeneratedPrompt: async () => true,
  createWorkItemEvent: async () => ({}),
  createWorkItemEvents: async () => [],
  getWorkItemEventsByWorkItemId: async () => [],
  getEventsByDateRange: async () => [],
  getBoardColumnsByIds: async () => [testBoardColumn],
  getWorkItemHierarchy: async () => [],
  getDependencies: async () => [],
  getDependenciesBatch: async () => [],
  getDependents: async () => [],
  addDependency: async () => ({ id: "dep-1" }),
  removeDependency: async () => true,
  getDocumentsByWorkItemId: async () => [],
  linkDocumentToWorkItem: async () => ({ id: "link-1" }),
  unlinkDocumentFromWorkItem: async () => true,
  createDocument: async () => ({ id: "doc-1", title: "Test Doc", projectId: null }),
  getSuggestedDocuments: async () => [],
  getAttachmentsByWorkItem: async () => [],
  createAttachment: async () => ({ id: "att-1" }),
  deleteAttachment: async () => true,
  getAttachment: async () => null,
  getAiSessionsSummaryByWorkItemId: async (_orgId: string) => ({ sessions: [], summary: {} }),
  createAiSession: async (_orgId: string) => ({ id: "session-1" }),

  // Provider connections (AI provider keys)
  getAiProviderKeyById: async () => null,
  updateConnectionLastUsedAt: async () => {},
  updateAiProviderKeyCredentials: async () => null,
  deactivateConnection: async () => false,
  decryptCredentials: () => ({ apiKey: "test-key" }),
  mapConnectionProviderToAiProvider: (p: string) => p,

  // Worker interactions
  getInteractionsByWorkItemId: async () => [],
  getUserById: async () => null,
  getMembersByWorkspaceId: async () => [
    {
      memberId: "member-test-1",
      userId: testUser.id,
      name: testUser.name,
      email: testUser.email,
      image: testUser.image,
      role: "owner",
      joinedAt: new Date("2025-01-01"),
    },
    {
      memberId: "member-test-2",
      userId: "user-test-2",
      name: "Test Collaborator",
      email: "collaborator@example.com",
      image: null,
      role: "member",
      joinedAt: new Date("2025-01-01"),
    },
  ],
  getAssigneesByWorkItem: async () => [],
  assignUserToWorkItem: async () => ({ id: "wa-1" }),
  unassignUserFromWorkItem: async () => true,
  updateAssigneeRole: async () => true,

  // Boards
  getAllBoards: async () => [testBoard],
  getBoardById: async (id: string) => (id === testBoard.id ? testBoard : null),
  getBoardByIdInternal: async (id: string) => (id === testBoard.id ? testBoard : null),
  createBoard: async (...args: unknown[]) => ({ ...testBoard, ...getLastObjectArg(args) }),
  updateBoard: async (...args: unknown[]) => {
    const id = getLastStringArg(args);
    return id === testBoard.id ? { ...testBoard, ...getLastObjectArg(args) } : null;
  },
  deleteBoard: async (...args: unknown[]) => getLastStringArg(args) === testBoard.id,
  getBoardColumns: async () => [testBoardColumn],
  createColumn: async () => testBoardColumn,
  updateColumn: async () => testBoardColumn,
  deleteColumn: async () => true,
  reorderColumns: async () => [testBoardColumn],
  createBoardFromTemplate: async () => testBoard,
  getWorkItemsByBoard: async () => [{ column: testBoardColumn, items: [testWorkItem], count: 1 }],
  getBoardTemplates: async () => [],
  getBoardsByArea: async () => [testBoard],
  getSprintsByBoard: async () => [],
  getActiveSprint: async () => null,
  getSprintById: async () => null,
  createSprint: async () => ({ id: "sprint-1", name: "Sprint 1", status: "active" }),
  closeSprint: async () => ({ id: "sprint-1", name: "Sprint 1", status: "closed" }),
  closeSprintAdHoc: async () => ({ id: "sprint-1", name: "Sprint 1", status: "closed" }),
  closeSprintByDate: async () => ({ id: "sprint-1", name: "Sprint 1", status: "closed" }),
  getSprintWorkItems: async () => [],
  getNextSprintNumber: async () => 1,
  getDoneItemsPreview: async () => [],
  getCompletedWorkItemsByDateRange: async () => [],

  // Integration batches
  getActiveBatchForRepository: async () => null,
  getOpenReleaseBatchForRepository: async () => null,
  getNextReleaseNumber: async () => 1,
  getBatchByFinalPrNumber: async () => null,
  getGithubRepoFullNameByRepoId: async () => "example/test-repo",
  clearReleasePullRequestForBatch: async () => 0,
  setReleasePullRequestForBatch: async () => 0,
  moveMergedIntegrationBatchItemsToReleaseColumn: async () => ({
    moved: 0,
    alreadyInRelease: 0,
    skippedMissingReleaseColumn: 0,
    missingReleaseColumnBoardIds: [],
    failed: [],
  }),
  updateReleasePullRequestStateForBatch: async () => 0,
  getBatchById: async (id: string) => (id === testIntegrationBatch.id ? testIntegrationBatch : null),
  getBatchByIdWithItems: async (id: string) =>
    id === testIntegrationBatch.id
      ? { ...testIntegrationBatch, items: [testIntegrationBatchItem] }
      : null,
  listActiveBatchesByProject: async () => [testIntegrationBatch],
  getValidatingReleaseCandidates: async () => ({
    candidates: [
      {
        id: testWorkItem.id,
        taskId: testWorkItem.taskId,
        title: testWorkItem.title,
        boardId: testWorkItem.boardId,
        projectId: testProject.id,
        repositoryId: testRepository.id,
        repositoryFullName: "example/test-repo",
        baseBranch: "main",
        prNumber: 42,
        prUrl: "https://github.com/acme/almirant/pull/42",
        branchName: "feature/test-work-item",
        updatedAt: new Date(),
      },
    ],
    skipped: { missingPullRequest: 0, unresolvedRepository: 0 },
  }),
  createIntegrationBatch: async (...args: unknown[]) => ({
    ...testIntegrationBatch,
    ...getLastObjectArg(args),
  }),
  updateBatchStatus: async () => testIntegrationBatch,
  setCurrentItemIndex: async () => testIntegrationBatch,
  setSandboxContainerId: async () => testIntegrationBatch,
  addItemsToBatch: async () => [testIntegrationBatchItem],
  updateItemStatus: async () => testIntegrationBatchItem,
  setItemFailure: async () => testIntegrationBatchItem,
  listItemsByBatch: async () => [testIntegrationBatchItem],

  // Agent jobs (used by integration-batches route to enqueue)
  createJob: async (...args: unknown[]) => {
    const input = getLastObjectArg(args);
    return {
      id: "job-test-1",
      jobType: input.jobType ?? "implementation",
      status: "queued",
      ...input,
    };
  },

  // Projects
  getProjects: async () => ({ projects: [testProject], total: 1 }),
  getProjectById: async (...args: unknown[]) => (getLastStringArg(args) === testProject.id ? testProject : null),
  createProject: async (...args: unknown[]) => ({ ...testProject, ...getLastObjectArg(args) }),
  updateProject: async (...args: unknown[]) => {
    const id = getLastStringArg(args);
    return id === testProject.id ? { ...testProject, ...getLastObjectArg(args) } : null;
  },
  archiveProject: async (...args: unknown[]) => {
    const id = getLastStringArg(args);
    return id === testProject.id ? { ...testProject, status: "archived" as const } : null;
  },
  deleteProject: async (...args: unknown[]) => getLastStringArg(args) === testProject.id,
  getProjectMembers: async () => [],
  addProjectMember: async () => ({ id: "member-1" }),
  removeProjectMember: async () => true,
  getDocLinks: async () => [],
  createDocLink: async () => ({ id: "link-1" }),
  updateDocLink: async () => ({ id: "link-1" }),
  deleteDocLink: async () => true,
  reorderDocLinks: async () => [],
  getNotes: async () => [],
  getNoteById: async () => null,
  createNote: async () => ({ id: "note-1" }),
  updateNote: async () => ({ id: "note-1" }),
  deleteNote: async () => true,
  reorderNotes: async () => [],
  getRepositories: async () => [],
  createRepository: async () => ({ id: "repo-1" }),
  updateRepository: async () => ({ id: "repo-1" }),
  deleteRepository: async () => true,
  reorderRepositories: async () => [],
  extractGithubRepoFullName: (url: string) => {
    const httpsMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    if (httpsMatch) return httpsMatch[1]!;

    const sshMatch = url.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    if (sshMatch) return sshMatch[1]!;

    return null;
  },
  getGithubConnectionForWorkspace: async () => null,
  linkRepoToInstallation: async () => ({ id: "repo-installation-link-1" }),
  getUnlinkedGithubRepos: async () => [],
  getAllGithubRepoUrls: async () => [],
  getProjectRoadmap: async () => [],

  // Seeds
  getSeeds: async () => ({ items: [testSeed], total: 1 }),
  getSeedById: async (...args: unknown[]) => {
    const id = getLastStringArg(args);
    return id === testSeed.id ? testSeed : null;
  },
  createSeed: async (...args: unknown[]) => ({ ...testSeed, ...getLastObjectArg(args) }),
  updateSeed: async (...args: unknown[]) => {
    const id = typeof args[1] === "string" ? (args[1] as string) : getLastStringArg(args);
    return id === testSeed.id ? { ...testSeed, ...getLastObjectArg(args) } : null;
  },
  deleteSeed: async (...args: unknown[]) => {
    const id = getLastStringArg(args);
    return id === testSeed.id;
  },
  setSeedStatus: async (...args: unknown[]) => {
    const id = typeof args[1] === "string" ? (args[1] as string) : getLastStringArg(args);
    if (id !== testSeed.id) return null;
    const status = typeof args[2] === "string" ? args[2] : testSeed.status;
    return { ...testSeed, status };
  },
  assignSeedOwner: async () => ({ ...testSeed }),
  toggleSeedSelectedForIdeation: async () => true,
  bulkSelectSeedsForIdeation: async () => true,
  getSelectedSeedsForIdeation: async () => [testSeed],
  linkFeedbackToSeed: async () => ({ id: "link-1" }),
  unlinkFeedbackFromSeed: async (...args: unknown[]) => {
    const id = typeof args[1] === "string" ? (args[1] as string) : getLastStringArg(args);
    return id === testSeed.id;
  },
  linkWorkItemToSeed: async () => ({
    id: "link-1",
    seedId: testSeed.id,
    workItemId: testWorkItem.id,
    linkType: "promoted_to",
    createdAt: new Date("2025-01-01"),
  }),
  addTagToSeed: async () => ({ id: "tag-link-1" }),
  removeTagFromSeed: async () => true,
  getSeedEvents: async () => ({ items: [], total: 0 }),
  createTagIfNotExists: async () => ({ id: "tag-1", name: "test-tag" }),
  getTagById: async () => ({ id: "tag-1", name: "test-tag", workspaceId: "org-test-1" }),
  enqueueNotification: async () => {},
  parseMentionsFromHtml: () => [],
  getEntityComments: async () => [],
  createEntityComment: async () => ({
    id: "comment-test-1",
    entityType: "seed",
    entityId: testSeed.id,
    userId: testUser.id,
    content: "test comment",
    createdAt: new Date("2025-01-01").toISOString(),
    updatedAt: new Date("2025-01-01").toISOString(),
    author: { id: testUser.id, name: testUser.name, email: testUser.email, image: testUser.image },
  }),
  updateEntityComment: async () => ({
    id: "comment-test-1",
    content: "updated comment",
  }),
  deleteEntityComment: async () => true,

  // Ideas Hub
  getIdeaItems: async () => ({ items: [testIdeaItem], total: 1 }),
  getIdeaItemById: async (...args: unknown[]) => {
    const id = getLastStringArg(args);
    return id === testIdeaItem.id ? testIdeaItem : null;
  },
  createIdeaItem: async (...args: unknown[]) => {
    const workspaceId =
      typeof args[0] === "string" ? (args[0] as string) : testIdeaItem.workspaceId;
    const input =
      args[1] && typeof args[1] === "object" && !Array.isArray(args[1])
        ? (args[1] as Record<string, unknown>)
        : getLastObjectArg(args);
    return {
      ...testIdeaItem,
      ...input,
      workspaceId,
      id: testIdeaItem.id,
      title: String(input.title ?? testIdeaItem.title).trim(),
      type: (input.type as "idea" | "seed" | undefined) ?? testIdeaItem.type,
      status:
        (input.status as "active" | "archived" | "pending" | "done" | "blocked" | undefined) ??
        testIdeaItem.status,
      feedbackLinks: [],
      workItemLinks: [],
    };
  },
  updateIdeaItem: async (...args: unknown[]) => {
    const id = typeof args[1] === "string" ? (args[1] as string) : getLastStringArg(args);
    if (id !== testIdeaItem.id) return null;
    const input =
      args[2] && typeof args[2] === "object" && !Array.isArray(args[2])
        ? (args[2] as Record<string, unknown>)
        : getLastObjectArg(args);
    return { ...testIdeaItem, ...input, id: testIdeaItem.id };
  },
  deleteIdeaItem: async (...args: unknown[]) => getLastStringArg(args) === testIdeaItem.id,
  setIdeaItemStatus: async (...args: unknown[]) => {
    const id = typeof args[1] === "string" ? (args[1] as string) : getLastStringArg(args);
    if (id !== testIdeaItem.id) return null;
    const status = typeof args[2] === "string" ? args[2] : testIdeaItem.status;
    return { ...testIdeaItem, status };
  },
  assignIdeaItemOwner: async (...args: unknown[]) => {
    const id = typeof args[1] === "string" ? (args[1] as string) : getLastStringArg(args);
    if (id !== testIdeaItem.id) return null;
    const ownerUserId = (args[2] as string | null | undefined) ?? null;
    return { ...testIdeaItem, ownerUserId };
  },
  setIdeaItemDueDate: async (...args: unknown[]) => {
    const id = typeof args[1] === "string" ? (args[1] as string) : getLastStringArg(args);
    if (id !== testIdeaItem.id) return null;
    const dueDate = (args[2] as string | null | undefined) ?? null;
    return { ...testIdeaItem, dueDate };
  },
  getIdeaItemTraceability: async (...args: unknown[]) => {
    const id = getLastStringArg(args);
    if (id !== testIdeaItem.id) return null;
    return {
      ideaItem: {
        id: testIdeaItem.id,
        workspaceId: testIdeaItem.workspaceId,
        projectId: testIdeaItem.projectId,
        type: testIdeaItem.type,
        status: testIdeaItem.status,
        title: testIdeaItem.title,
        description: testIdeaItem.description,
        ownerUserId: testIdeaItem.ownerUserId,
        dueDate: testIdeaItem.dueDate,
        metadata: testIdeaItem.metadata,
        createdAt: testIdeaItem.createdAt,
        updatedAt: testIdeaItem.updatedAt,
      },
      feedbackLinks: [],
      workItemLinks: [],
    };
  },
  getIdeaItemEventsByIdeaItemId: async () => ({
    items: [
      {
        id: "idea-event-test-1",
        ideaItemId: testIdeaItem.id,
        eventType: "created",
        fieldName: null,
        oldValue: null,
        newValue: null,
        triggeredBy: "user",
        triggeredByUserId: testUser.id,
        metadata: { title: testIdeaItem.title },
        createdAt: new Date("2025-01-01"),
        triggeredByUserName: testUser.name,
        triggeredByUserImage: testUser.image,
        triggeredByUserEmail: testUser.email,
      },
    ],
    total: 1,
  }),
  linkFeedbackToIdeaItem: async (...args: unknown[]) => ({
    id: "idea-feedback-link-test-1",
    ideaItemId: String(args[1] ?? testIdeaItem.id),
    feedbackItemId: String(args[2] ?? "feedback-test-1"),
    metadata: (args[3] as Record<string, unknown> | undefined) ?? {},
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  }),
  toggleIdeaItemDiscussed: async (...args: unknown[]) => {
    const id = typeof args[1] === "string" ? (args[1] as string) : getLastStringArg(args);
    if (id !== testIdeaItem.id) return null;
    const discussed = typeof args[2] === "boolean" ? args[2] : false;
    return { ...testIdeaItem, discussed };
  },
  getSelectedSeeds: async () => [],
  bulkSelectForIdeation: async () => 0,
  getCommentsByIdeaItem: async () => [],
  getIdeaItemCommentVersions: async () => [],
  createIdeaItemComment: async (...args: unknown[]) => ({
    id: "comment-test-1",
    ideaItemId: String(args[1] ?? testIdeaItem.id),
    userId: String(args[2] ?? testUser.id),
    content: String(args[3] ?? "test comment"),
    createdAt: new Date("2025-01-01").toISOString(),
    updatedAt: new Date("2025-01-01").toISOString(),
    author: { id: testUser.id, name: testUser.name, email: testUser.email, image: testUser.image },
  }),
  updateIdeaItemComment: async () => ({
    id: "comment-test-1",
    ideaItemId: testIdeaItem.id,
    userId: testUser.id,
    content: "updated comment",
    createdAt: new Date("2025-01-01").toISOString(),
    updatedAt: new Date("2025-01-01").toISOString(),
    author: { id: testUser.id, name: testUser.name, email: testUser.email, image: testUser.image },
  }),
  deleteIdeaItemComment: async () => true,
  getCommentCountByIdeaItem: async () => 0,
  getEntityCommentVersions: async () => [],
  getWorkspaceMemberUserIdByGithubLogin: async () => testUser.id,
  unlinkFeedbackFromIdeaItem: async (...args: unknown[]) =>
    (typeof args[1] === "string" ? args[1] : getLastStringArg(args)) === testIdeaItem.id,
  linkWorkItemToIdeaItem: async (...args: unknown[]) => ({
    id: "idea-work-item-link-test-1",
    ideaItemId: String(args[1] ?? testIdeaItem.id),
    workItemId: String(args[2] ?? testWorkItem.id),
    linkType: (args[3] as "promoted_to" | "related_to" | undefined) ?? "related_to",
    createdBy: (args[4] as string | null | undefined) ?? null,
    metadata: (args[5] as Record<string, unknown> | undefined) ?? {},
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
  }),

  ...overrides,
});

/** WebSocket connection manager mock */
export const createWsMock = () => ({
  wsConnectionManager: {
    broadcastToWorkspace: () => {},
    sendToUser: () => {},
  },
});

/** Response helpers mock - passes data through transparently */
export const createResponseMocks = () => ({
  successResponse: (data: unknown, meta?: unknown) =>
    meta === undefined
      ? { success: true, data }
      : { success: true, data, meta },
  errorResponse: (error: string, _status?: number, code?: string) => ({
    success: false,
    error,
    ...(code ? { code } : {}),
  }),
  notFoundResponse: (resource: string = "Resource") => ({ success: false, error: `${resource} not found` }),
  parsePaginationParams: (query: Record<string, string | undefined>) => ({
    page: Math.max(1, parseInt(query.page || "1")),
    limit: Math.min(100, Math.max(1, parseInt(query.limit || "50"))),
    offset: (Math.max(1, parseInt(query.page || "1")) - 1) * Math.min(100, Math.max(1, parseInt(query.limit || "50"))),
  }),
  buildPaginationMeta: (page: number, limit: number, total: number) => ({
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  }),
});

/** Config mock (logger + env with test defaults) */
export const createLoggerMock = () => ({
  env: {
    NODE_ENV: "test",
    PORT: 3001,
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
    CORS_ORIGIN: "http://localhost:3000",
    LOG_LEVEL: "info",
    AGENT_JOB_LOG_RETENTION_DAYS: 7,
    AGENT_JOB_LOG_SWEEPER_INTERVAL_MS: 60_000,
    AGENT_JOB_LOG_SWEEPER_BATCH_SIZE: 1_000,
    S3_REGION: "eu-central",
    OPENAI_MODEL: "gpt-4.1-nano",
    OPENAI_PROMPT_MODEL: "gpt-5-mini",
    FEEDBACK_INGEST_RATE_LIMIT_WINDOW_MS: 60_000,
    FEEDBACK_INGEST_RATE_LIMIT_MAX: 20,
    FEEDBACK_WIDGET_TOKEN_TTL_SECONDS: 600,
    FEEDBACK_INGEST_DEDUPE_WINDOW_SECONDS: 120,
    CONTACT_RATE_LIMIT_WINDOW_MS: 60_000,
    CONTACT_RATE_LIMIT_MAX: 5,
    CONTACT_RECIPIENTS: "",
    SCALING_MIN_AVAILABLE_SLOTS: 1,
  },
  logger: {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  },
});

/** S3 service mock */
export const createS3Mock = () => ({
  getS3Client: () => ({
    send: async () => ({
      Body: {
        transformToByteArray: async () => new Uint8Array(),
        transformToString: async () => "",
      },
    }),
  }),
  uploadBufferToS3: async () => "https://s3.example.com/test-file",
  downloadBufferFromS3: async () => new Uint8Array(),
  deleteFromS3: async () => {},
  generateAttachmentKey: (_workItemId: string, fileName: string) => `work-items/test/${fileName}`,
  generateEditorImageKey: (_workspaceId: string, fileName: string) => `editor-images/test/${fileName}`,
  generateEditorFileKey: (_workspaceId: string, fileName: string) => `editor-files/test/${fileName}`,
  generateFeedbackScreenshotKey: (fileName: string) => `feedback-screenshots/test-${fileName}`,
  generateInvoiceKey: (_workspaceId: string, fileName: string) => `invoices/test/${fileName}`,
  extractKeyFromUrl: () => "test-key",
  isS3Configured: () => false,
  getEditorUploadsBucket: () => null,
});

/** Local attachments mock */
export const createLocalAttachmentsMock = () => ({
  resolveLocalAttachmentPath: () => "/tmp/test-attachment",
  writeLocalAttachment: async () => {},
  deleteLocalAttachment: async () => {},
});

/** AI service mock */
export const createAiServiceMock = () => ({
  formatText: async () => "formatted text",
  isAiConfigured: () => false,
  generateDocumentation: async () => "# Documentation",
});

/** Telegram notifications mock */
export const createTelegramMock = () => ({
  notifyReviewCompleted: () => {},
  notifySprintClosed: () => {},
  notifyWorkItemAssigned: () => {},
  notifyWorkItemDone: () => {},
  notifyWorkItemMoved: () => {},
  notifyUserActions: () => {},
});

/** Work item sync mock (cascade logic removed in A-180) */
export const createWorkItemSyncMock = () => ({
  getParentForSync: async () => null,
  isColumnDone: async () => false,
  getColumnOrder: async () => -1,
});

/** Prompt context mock */
export const createPromptContextMock = () => ({
  gatherWorkItemContext: async () => null,
  buildEnrichedPromptInput: () => "enriched prompt",
});

/** AI model pricing mock */
export const createAiPricingMock = () => ({
  calculateCostUsd: () => 0.01,
});

/** Screenshot service mock */
export const createScreenshotMock = () => ({
  captureAndStoreScreenshot: async () => {},
  isLocalProjectScreenshotUrl: () => false,
  readLocalProjectScreenshot: async () => null,
});

/** Sprint visual report mock */
export const createSprintReportMock = () => ({
  kickoffSprintVisualReportGeneration: () => {},
});

/** GitHub service mock — all named exports with sensible defaults.
 *  Override individual functions as needed via the overrides param. */
export const createGithubServiceMock = (overrides: Record<string, unknown> = {}) => ({
  isGithubConfigured: () => true,
  isGithubConfiguredAsync: async () => true,
  generateAppJwt: () => "mock-jwt",
  getInstallationAccessToken: async () => "mock-token",
  fetchFromGithub: async () => ({}),
  mutateGithub: async () => ({}),
  createRepository: async () => ({
    id: 1, name: "repo", full_name: "org/repo", html_url: "", default_branch: "main", private: true, description: null,
  }),
  createRepositoryWithUserToken: async () => ({
    id: 1, name: "repo", full_name: "user/repo", html_url: "", default_branch: "main", private: true, description: null,
  }),
  fetchRecentCommits: async () => [],
  fetchOpenPullRequests: async () => [],
  fetchRecentlyUpdatedPullRequests: async () => [],
  fetchWorkflowRuns: async () => [],
  fetchRepositoryInfo: async () => ({}),
  fetchInstallationRepositories: async () => ({ repositories: [], total_count: 0 }),
  syncInstallationsFromGithub: async () => [],
  verifyWebhookSignature: () => true,
  updatePrDescriptionWithPreviewUrl: async () => {},
  parseGithubPrUrl: () => null,
  fetchRepositoryTree: async () => [],
  ...overrides,
});

/**
 * Re-registers real module implementations for commonly-mocked packages.
 * Call this in afterAll() after mock.restore() to prevent mock.module()
 * registrations from leaking into subsequent test files.
 *
 * Bun's mock.restore() clears spies but does NOT clear mock.module()
 * registrations, so explicit re-registration is required.
 */
export const restoreRealModules = () => {
  const { mock } = require("bun:test");
  mock.module("@almirant/database", () => __realDatabase);
  mock.module("@almirant/config", () => __realConfig);
  // Relative paths resolve from THIS file (src/test/mocks.ts) to the same
  // absolute paths that cross-org-isolation.test.ts and build-tools-registry.test.ts
  // use when installing the mocks. Bun keys mock.module by resolved absolute path,
  // so restoration here re-registers the real exports for every downstream test file.
  mock.module("../domains/billing/quota/services/ai-model-pricing", () => __realAiModelPricing);
  mock.module("../lib/memory/ranker", () => __realRanker);
  mock.module("../lib/memory/scrubber", () => __realScrubber);
  mock.module("../domains/agents/services/agent-job-enrichment", () => __realAgentJobEnrichment);
  mock.module("../shared/ws/feedback-events", () => __realFeedbackEvents);
};
