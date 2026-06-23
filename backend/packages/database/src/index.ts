// Re-export client
export { db, schema, closeConnections } from "./client";
export type { Database } from "./client";

// Re-export all schema tables, enums, relations, and types
export * from "./schema";

// Re-export utility functions
export { parseMentionsFromHtml } from "./utils/mention-parser";

// Re-export pure helpers under src/lib
export {
  buildClusterTimeline,
  type BuildClusterTimelineInput,
} from "./lib/cluster-timeline-builder";

export {
  buildClusterSummary,
  type BuildClusterSummaryInput,
} from "./lib/cluster-summary-builder";

// Re-export all repository functions
export * from "./repositories";

// Re-export work item type guards (value exports)
export { isLeafType, isParentType } from "./domain/types";

// Re-export selected domain types (selective to avoid conflicts with schema table types)
export type {
  WorkItemType,
  ParentWorkItemType,
  LeafWorkItemType,
  SprintReport,
  SprintReportScreenshotsSection,
  SprintReportScreenshotGroup,
  SprintReportScreenshot,
  SprintVisualReportDocumentRef,
  SprintComparison,
  UserSprintStats,
  SprintWorkItemDetail,
  SprintWorkItemDetailExtended,
  SprintWithCount,
  // Feedback types
  FeedbackSourceType,
  FeedbackStatus,
  FeedbackCategory,
  FeedbackClusterStatus,
  PromoteFeedbackRequest,
  PromoteFeedbackResponse,
  PromoteClusterRequest,
  PromoteClusterResponse,
  FeedbackTraceabilityResult,
  // Ideas Hub
  IdeaItemType,
  IdeaItemStatus,
  IdeaItemWorkLinkType,
  IdeaItemEventType,
  IdeaItemEventTriggeredBy,
  IdeaItem,
  IdeaItemFeedbackLink,
  IdeaItemWorkItemLink,
  IdeaItemEvent,
  IdeaItemWithRelations,
  IdeaItemFilters,
  CreateIdeaItemRequest,
  UpdateIdeaItemRequest,
  IdeaItemTraceabilityResult,
  IdeaItemEventContext,
  PromoteIdeaItemRequest,
  PromoteIdeaItemResponse,
  // Seeds
  SeedStatus,
  SeedStatusGroup,
  SeedSource,
  Seed,
  SeedWithRelations,
  SeedFilters,
  CreateSeedInput,
  UpdateSeedInput,
  SeedEventContext,
  // Work item documentation
  WorkItemDocumentation,
  // Work item assignees
  AssigneeRole,
  WorkItemAssignee,
  AssignWorkItemRequest,
  UpdateAssigneeRoleRequest,
} from "./domain/types";

// Re-export roadmap types
export type { ProjectRoadmap } from "./repositories/project-management/roadmap-repository";

// Re-export commonly used drizzle-orm operators for convenience
export {
  eq,
  and,
  or,
  not,
  gt,
  gte,
  lt,
  lte,
  ne,
  isNull,
  isNotNull,
  inArray,
  notInArray,
  between,
  like,
  ilike,
  sql,
  desc,
  asc,
  count,
} from "drizzle-orm";
