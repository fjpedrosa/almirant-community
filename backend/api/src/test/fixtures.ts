// Test data fixtures for integration tests
// These provide consistent, typed test data for all test files.

export const testUser = {
  id: "user-test-1",
  name: "Test User",
  email: "test@example.com",
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const testProject = {
  id: "proj-test-1",
  name: "Test Project",
  description: "A test project",
  status: "active" as const,
  color: "#3b82f6",
  icon: null,
  folderPath: null,
  clientName: null,
  productionUrl: null,
  stagingUrl: null,
  screenshotUrl: null,
  techStack: null,
  startDate: null,
  targetDate: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const testBoardColumn = {
  id: "col-test-1",
  boardId: "board-test-1",
  name: "Backlog",
  color: "#94a3b8",
  order: 0,
  isDone: false,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const testBoardColumnDone = {
  ...testBoardColumn,
  id: "col-test-done",
  name: "Done",
  order: 3,
  isDone: true,
};

export const testBoard = {
  id: "board-test-1",
  projectId: "proj-test-1",
  name: "Test Board",
  description: null,
  area: "desarrollo" as const,
  isDefault: false,
  allowedTypes: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  columns: [testBoardColumn],
};

export const testWorkItem = {
  id: "wi-test-1",
  projectId: "proj-test-1",
  boardId: "board-test-1",
  boardColumnId: "col-test-1",
  parentId: null,
  type: "task" as const,
  title: "Test Work Item",
  description: "A test work item description",
  priority: "medium" as const,
  assignee: null,
  position: 0,
  dueDate: null,
  estimatedHours: null,
  metadata: null,
  isAiProcessing: false,
  taskId: "MC-TEST-1",
  archivedAt: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  // Extended fields from getWorkItemById
  columnName: "Backlog",
  boardName: "Test Board",
  tags: [],
};

export const testIdeaItem = {
  id: "idea-test-1",
  workspaceId: "org-test-1",
  projectId: "proj-test-1",
  type: "idea" as const,
  status: "active" as const,
  title: "Test Idea Item",
  description: "A test idea item description",
  ownerUserId: "user-test-1",
  dueDate: null,
  metadata: {},
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  owner: {
    id: "user-test-1",
    name: "Test User",
    email: "test@example.com",
    image: null,
  },
  projectName: "Test Project",
  feedbackLinks: [],
  workItemLinks: [],
};

export const testWorkspace = {
  id: "org-test-1",
  name: "Test Workspace",
  slug: "test-org",
};

// Factory functions for creating variants
export const makeWorkItem = (overrides: Record<string, unknown> = {}) => ({
  ...testWorkItem,
  ...overrides,
});

export const makeProject = (overrides: Record<string, unknown> = {}) => ({
  ...testProject,
  ...overrides,
});

export const makeBoard = (overrides: Record<string, unknown> = {}) => ({
  ...testBoard,
  ...overrides,
});

export const testSeed = {
  id: "seed-test-1",
  workspaceId: "org-test-1",
  projectId: "proj-test-1",
  title: "Test Seed",
  description: "A test seed description",
  status: "active" as const,
  source: "manual" as const,
  priority: "medium" as const,
  selectedForIdeation: false,
  ownerUserId: "user-test-1",
  createdByUserId: "user-test-1",
  metadata: {},
  maturityLevel: 1,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  owner: { id: "user-test-1", name: "Test User", email: "test@example.com", image: null },
  createdBy: { id: "user-test-1", name: "Test User", email: "test@example.com", image: null },
  projectName: "Test Project",
  commentCount: 0,
  lastComment: null,
  feedbackLinks: [],
  workItemLinks: [],
  tags: [],
};

// ---------------------------------------------------------------------------
// Workspace B — second org for cross-org isolation tests
// ---------------------------------------------------------------------------

export const testWorkspaceB = {
  id: "org-test-2",
  name: "Test Workspace B",
  slug: "test-org-b",
};

export const testUserB = {
  id: "user-test-2",
  name: "Test User B",
  email: "testb@example.com",
  image: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const testProjectB = {
  id: "proj-test-2",
  name: "Test Project B",
  description: "A test project for Org B",
  status: "active" as const,
  color: "#ef4444",
  icon: null,
  folderPath: null,
  clientName: null,
  productionUrl: null,
  stagingUrl: null,
  screenshotUrl: null,
  techStack: null,
  startDate: null,
  targetDate: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

// ---------------------------------------------------------------------------
// Integration batches — Phase 2 of integration agent feature
// ---------------------------------------------------------------------------

export const testRepository = {
  id: "repo-test-1",
  projectId: "proj-test-1",
  name: "test-repo",
  url: "https://github.com/example/test-repo",
  provider: "github" as const,
  isMonorepo: false,
  docsPath: null,
  order: 0,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const testIntegrationBatch = {
  id: "batch-test-1",
  workspaceId: "org-test-1",
  projectId: "proj-test-1",
  repositoryId: "repo-test-1",
  boardId: "board-test-1",
  integrationBranch: "release/main-v1",
  baseBranch: "main",
  releaseNumber: 1,
  status: "queued" as const,
  triggeredByUserId: "user-test-1",
  currentItemIndex: 0,
  sandboxContainerId: null,
  finalPrUrl: null,
  finalPrNumber: null,
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const testIntegrationBatchItem = {
  id: "batch-item-test-1",
  batchId: "batch-test-1",
  workItemId: "wi-test-1",
  prNumber: null,
  prUrl: null,
  branchName: null,
  processingOrder: 0,
  status: "pending" as const,
  failureCategory: null,
  failureReason: null,
  commitShaBefore: null,
  commitShaAfter: null,
  migrationRegenerated: false,
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const testBoardColumnB = {
  id: "col-test-2",
  boardId: "board-test-2",
  name: "Backlog",
  color: "#94a3b8",
  order: 0,
  isDone: false,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const testBoardB = {
  id: "board-test-2",
  projectId: "proj-test-2",
  name: "Test Board B",
  description: null,
  area: "desarrollo" as const,
  isDefault: false,
  allowedTypes: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  columns: [testBoardColumnB],
};

export const testWorkItemB = {
  id: "wi-test-2",
  projectId: "proj-test-2",
  boardId: "board-test-2",
  boardColumnId: "col-test-2",
  parentId: null,
  type: "task" as const,
  title: "Test Work Item B",
  description: "A test work item description for Org B",
  priority: "medium" as const,
  assignee: null,
  position: 0,
  dueDate: null,
  estimatedHours: null,
  metadata: null,
  isAiProcessing: false,
  taskId: "MC-TEST-2",
  archivedAt: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  columnName: "Backlog",
  boardName: "Test Board B",
  tags: [],
};

export const testIdeaItemB = {
  id: "idea-test-2",
  workspaceId: "org-test-2",
  projectId: "proj-test-2",
  type: "idea" as const,
  status: "active" as const,
  title: "Test Idea Item B",
  description: "A test idea item description for Org B",
  ownerUserId: "user-test-2",
  dueDate: null,
  metadata: {},
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  owner: {
    id: "user-test-2",
    name: "Test User B",
    email: "testb@example.com",
    image: null,
  },
  projectName: "Test Project B",
  feedbackLinks: [],
  workItemLinks: [],
};

export const testSeedB = {
  id: "seed-test-2",
  workspaceId: "org-test-2",
  projectId: "proj-test-2",
  title: "Test Seed B",
  description: "A test seed description for Org B",
  status: "active" as const,
  source: "manual" as const,
  priority: "medium" as const,
  selectedForIdeation: false,
  ownerUserId: "user-test-2",
  createdByUserId: "user-test-2",
  metadata: {},
  maturityLevel: 1,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  owner: { id: "user-test-2", name: "Test User B", email: "testb@example.com", image: null },
  createdBy: { id: "user-test-2", name: "Test User B", email: "testb@example.com", image: null },
  projectName: "Test Project B",
  commentCount: 0,
  lastComment: null,
  feedbackLinks: [],
  workItemLinks: [],
  tags: [],
};

export const makeWorkItemB = (overrides: Record<string, unknown> = {}) => ({
  ...testWorkItemB,
  ...overrides,
});

export const makeProjectB = (overrides: Record<string, unknown> = {}) => ({
  ...testProjectB,
  ...overrides,
});
