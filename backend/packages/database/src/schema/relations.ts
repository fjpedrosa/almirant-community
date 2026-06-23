import { relations } from "drizzle-orm";
import { user } from "./auth";
import { expenseCategories } from "./expense-categories";
import { expenses } from "./expenses";
import { expenseTags } from "./expense-tags";
import { recurringExpenses } from "./recurring-expenses";
import { tags } from "./tags";
import { webhooks, webhookLogs } from "./webhooks";
import { projects, projectDocLinks, projectRepositories, projectNotes } from "./projects";
import { integrationBatches } from "./integration-batches";
import { integrationBatchItems } from "./integration-batch-items";
import { repoInstallationLinks, githubCommits, githubPullRequests, githubWorkflowRuns, githubEvents } from "./github";
import { boards, boardColumns } from "./boards";
import { workItems, workItemTags, workItemAssignees } from "./work-items";
import { workItemDependencies } from "./work-item-dependencies";
import { workItemCommits } from "./work-item-commits";
import { workItemEvents } from "./work-item-events";
import { aiSessions } from "./ai-sessions";
import { aiConversations } from "./ai-conversations";
import { agentJobs, workerRegistrations } from "./agent-jobs";
import { workerInteractions } from "./worker-interactions";
import { sessionEvents } from "./session-events";
import { documentCategories, documents } from "./documents";
import { documentReads } from "./document-reads";
import { documentFavorites } from "./document-favorites";
import { documentVersions } from "./document-versions";
import { documentWorkItems } from "./document-work-items";
import { sprints, sprintWorkItems } from "./sprints";
import { milestones, milestoneWorkItems } from "./milestones";
import { sprintDocuments } from "./sprint-documents";
import { savedViews } from "./saved-views";
import { telegramUsers, telegramLinkCodes } from "./telegram";
import { emailNotificationSettings } from "./email-notifications";
import { pushSubscriptions, pushNotificationSettings } from "./push-subscriptions";
import { onboardingStatus, onboardingEvents } from "./onboarding";
import { feedbackSources } from "./feedback-sources";
import { feedbackItems } from "./feedback-items";
import { feedbackClusters, feedbackPromotions } from "./feedback-clusters";
import { feedbackTopics } from "./feedback-topics";
import { feedbackTopicProposals } from "./feedback-topic-proposals";
import { bugFixAttempts } from "./bug-fix-attempts";
import { clusterStatusHistory } from "./cluster-status-history";
import { ideaItems } from "./idea-items";
import { ideaItemTags } from "./idea-item-tags";
import { todoItems } from "./todo-items";
import { todoItemTags } from "./todo-item-tags";
import { ideaItemFeedbackLinks, ideaItemWorkItemLinks } from "./idea-item-links";
import { seeds } from "./seeds";
import { seedTags } from "./seed-tags";
import { seedFeedbackLinks } from "./seed-feedback-links";
import { seedWorkItemLinks } from "./seed-work-item-links";
import { planningSessions } from "./planning-sessions";
import { planningSessionSeeds } from "./planning-session-seeds";
import { planningSessionWorkItems } from "./planning-session-work-items";
import { ideaItemEvents } from "./idea-item-events";
import { ideaItemComments } from "./idea-item-comments";
import { commentMentions } from "./comment-mentions";
import { notifications, notificationPreferences } from "./notifications";
import { entityComments } from "./entity-comments";
import { entityEvents } from "./entity-events";
import { providerQuotas, quotaAlerts } from "./quotas";
import { providerConnections } from "./provider-connections";
import { discordConnections, discordProjectChannels, discordNotificationPreferences } from "./discord-connections";
import { organization, member, invitation } from "./organization";
import { organizationSettings } from "./organization-settings";
import {
  waitlistUsers,
  waitlistReferrals,
  waitlistActions,
  waitlistEmailTokens,
  waitlistThankYouSends,
} from "./waitlist";
import { importJobs } from "./imports";
import { apiKeys } from "./api-keys";
import { serviceAccounts } from "./service-accounts";
import { taskIdCounters } from "./task-id-counters";
import { usageRecords, usageSummaries, userUsageSummaries } from "./usage";
import { userViewPreferences } from "./user-view-preferences";
import { scheduledAgentConfigs } from "./scheduled-agent-configs";
import { scheduledAgentRuns } from "./scheduled-agent-runs";
import { skills } from "./skills";
import { projectMembers } from "./project-members";
import { agentObservations } from "./agent-observations";

export const tagsRelations = relations(tags, ({ one, many }) => ({
  organization: one(organization, {
    fields: [tags.organizationId],
    references: [organization.id],
  }),
  workItemTags: many(workItemTags),
  ideaItemTags: many(ideaItemTags),
  todoItemTags: many(todoItemTags),
  seedTags: many(seedTags),
  expenseTags: many(expenseTags),
}));

export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  organization: one(organization, {
    fields: [webhooks.organizationId],
    references: [organization.id],
  }),
  logs: many(webhookLogs),
}));

export const webhookLogsRelations = relations(webhookLogs, ({ one }) => ({
  webhook: one(webhooks, {
    fields: [webhookLogs.webhookId],
    references: [webhooks.id],
  }),
}));

// Project Management Relations
export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organization, {
    fields: [projects.organizationId],
    references: [organization.id],
  }),
  docLinks: many(projectDocLinks),
  repositories: many(projectRepositories),
  notes: many(projectNotes),
  workItems: many(workItems),
  agentJobs: many(agentJobs),
  documents: many(documents),
  ideaItems: many(ideaItems),
  todoItems: many(todoItems),
  seeds: many(seeds),
  milestones: many(milestones),
  planningSessions: many(planningSessions),
  discordProjectChannels: many(discordProjectChannels),
  scheduledAgentConfigs: many(scheduledAgentConfigs),
  skills: many(skills),
  discordNotificationPreferences: many(discordNotificationPreferences),
  projectMembers: many(projectMembers),
}));

export const projectDocLinksRelations = relations(projectDocLinks, ({ one }) => ({
  project: one(projects, {
    fields: [projectDocLinks.projectId],
    references: [projects.id],
  }),
}));

export const projectRepositoriesRelations = relations(projectRepositories, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectRepositories.projectId],
    references: [projects.id],
  }),
  installationLinks: many(repoInstallationLinks),
  commits: many(githubCommits),
  pullRequests: many(githubPullRequests),
  workflowRuns: many(githubWorkflowRuns),
  events: many(githubEvents),
}));

export const projectNotesRelations = relations(projectNotes, ({ one }) => ({
  project: one(projects, {
    fields: [projectNotes.projectId],
    references: [projects.id],
  }),
}));

export const boardsRelations = relations(boards, ({ one, many }) => ({
  organization: one(organization, {
    fields: [boards.organizationId],
    references: [organization.id],
  }),
  columns: many(boardColumns),
  workItems: many(workItems),
  agentJobs: many(agentJobs),
  sprints: many(sprints),
  savedViews: many(savedViews),
  planningSessions: many(planningSessions),
}));

export const boardColumnsRelations = relations(boardColumns, ({ one, many }) => ({
  board: one(boards, {
    fields: [boardColumns.boardId],
    references: [boards.id],
  }),
  workItems: many(workItems),
}));

export const workItemsRelations = relations(workItems, ({ one, many }) => ({
  project: one(projects, {
    fields: [workItems.projectId],
    references: [projects.id],
  }),
  board: one(boards, {
    fields: [workItems.boardId],
    references: [boards.id],
  }),
  boardColumn: one(boardColumns, {
    fields: [workItems.boardColumnId],
    references: [boardColumns.id],
  }),
  parent: one(workItems, {
    fields: [workItems.parentId],
    references: [workItems.id],
    relationName: "parentChild",
  }),
  createdByUser: one(user, {
    fields: [workItems.createdByUserId],
    references: [user.id],
    relationName: "createdWorkItems",
  }),
  requestedByUser: one(user, {
    fields: [workItems.requestedByUserId],
    references: [user.id],
    relationName: "requestedWorkItems",
  }),
  children: many(workItems, { relationName: "parentChild" }),
  workItemTags: many(workItemTags),
  dependencies: many(workItemDependencies, { relationName: "workItemDependencies" }),
  dependents: many(workItemDependencies, { relationName: "blockedByDependencies" }),
  sprintWorkItems: many(sprintWorkItems),
  milestoneWorkItems: many(milestoneWorkItems),
  aiSessions: many(aiSessions),
  agentJobs: many(agentJobs),
  events: many(workItemEvents),
  documentWorkItems: many(documentWorkItems),
  feedbackPromotions: many(feedbackPromotions),
  assignees: many(workItemAssignees),
  ideaItemLinks: many(ideaItemWorkItemLinks),
  seedWorkItemLinks: many(seedWorkItemLinks),
  workItemCommits: many(workItemCommits, { relationName: "workItemCommits" }),
  planningSessionWorkItems: many(planningSessionWorkItems),
}));

export const workItemAssigneesRelations = relations(workItemAssignees, ({ one }) => ({
  workItem: one(workItems, {
    fields: [workItemAssignees.workItemId],
    references: [workItems.id],
  }),
  user: one(user, {
    fields: [workItemAssignees.userId],
    references: [user.id],
  }),
}));

export const agentJobsRelations = relations(agentJobs, ({ one, many }) => ({
  project: one(projects, {
    fields: [agentJobs.projectId],
    references: [projects.id],
  }),
  workItem: one(workItems, {
    fields: [agentJobs.workItemId],
    references: [workItems.id],
  }),
  board: one(boards, {
    fields: [agentJobs.boardId],
    references: [boards.id],
  }),
  planningSession: one(planningSessions, {
    fields: [agentJobs.planningSessionId],
    references: [planningSessions.id],
  }),
  aiSessions: many(aiSessions),
  workerInteractions: many(workerInteractions),
  sessionEvents: many(sessionEvents),
}));

export const workerInteractionsRelations = relations(workerInteractions, ({ one }) => ({
  agentJob: one(agentJobs, {
    fields: [workerInteractions.agentJobId],
    references: [agentJobs.id],
  }),
  workItem: one(workItems, {
    fields: [workerInteractions.workItemId],
    references: [workItems.id],
  }),
  answeredByUser: one(user, {
    fields: [workerInteractions.answeredBy],
    references: [user.id],
  }),
}));

export const sessionEventsRelations = relations(sessionEvents, ({ one }) => ({
  agentJob: one(agentJobs, {
    fields: [sessionEvents.agentJobId],
    references: [agentJobs.id],
  }),
  planningSession: one(planningSessions, {
    fields: [sessionEvents.planningSessionId],
    references: [planningSessions.id],
  }),
}));

export const workerRegistrationsRelations = relations(workerRegistrations, () => ({}));

export const workItemTagsRelations = relations(workItemTags, ({ one }) => ({
  workItem: one(workItems, {
    fields: [workItemTags.workItemId],
    references: [workItems.id],
  }),
  tag: one(tags, {
    fields: [workItemTags.tagId],
    references: [tags.id],
  }),
}));

// Work Item Dependency Relations
export const workItemDependenciesRelations = relations(workItemDependencies, ({ one }) => ({
  workItem: one(workItems, {
    fields: [workItemDependencies.workItemId],
    references: [workItems.id],
    relationName: "workItemDependencies",
  }),
  blockedByWorkItem: one(workItems, {
    fields: [workItemDependencies.blockedByWorkItemId],
    references: [workItems.id],
    relationName: "blockedByDependencies",
  }),
}));

// Work Item Commit Relations
export const workItemCommitsRelations = relations(workItemCommits, ({ one }) => ({
  workItem: one(workItems, {
    fields: [workItemCommits.workItemId],
    references: [workItems.id],
    relationName: "workItemCommits",
  }),
  commit: one(githubCommits, {
    fields: [workItemCommits.commitId],
    references: [githubCommits.id],
    relationName: "commitWorkItems",
  }),
}));

// AI Session Relations
export const aiSessionsRelations = relations(aiSessions, ({ one }) => ({
  workItem: one(workItems, {
    fields: [aiSessions.workItemId],
    references: [workItems.id],
  }),
  agentJob: one(agentJobs, {
    fields: [aiSessions.agentJobId],
    references: [agentJobs.id],
  }),
}));

// Work Item Event Relations
export const workItemEventsRelations = relations(workItemEvents, ({ one }) => ({
  workItem: one(workItems, {
    fields: [workItemEvents.workItemId],
    references: [workItems.id],
  }),
  triggeredByUser: one(user, {
    fields: [workItemEvents.triggeredByUserId],
    references: [user.id],
  }),
}));

// Telegram Relations
export const telegramUsersRelations = relations(telegramUsers, ({ one }) => ({
  user: one(user, {
    fields: [telegramUsers.userId],
    references: [user.id],
  }),
}));

export const telegramLinkCodesRelations = relations(telegramLinkCodes, ({ one }) => ({
  user: one(user, {
    fields: [telegramLinkCodes.userId],
    references: [user.id],
  }),
}));

// Email Notification Settings Relations
export const emailNotificationSettingsRelations = relations(emailNotificationSettings, ({ one }) => ({
  user: one(user, {
    fields: [emailNotificationSettings.userId],
    references: [user.id],
  }),
}));

// Push Subscriptions Relations
export const pushSubscriptionsRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(user, {
    fields: [pushSubscriptions.userId],
    references: [user.id],
  }),
}));

// Push Notification Settings Relations
export const pushNotificationSettingsRelations = relations(pushNotificationSettings, ({ one }) => ({
  user: one(user, {
    fields: [pushNotificationSettings.userId],
    references: [user.id],
  }),
}));

// Sprint Relations
export const sprintsRelations = relations(sprints, ({ one, many }) => ({
  board: one(boards, {
    fields: [sprints.boardId],
    references: [boards.id],
  }),
  sprintWorkItems: many(sprintWorkItems),
  sprintDocuments: many(sprintDocuments),
}));

export const sprintWorkItemsRelations = relations(sprintWorkItems, ({ one }) => ({
  sprint: one(sprints, {
    fields: [sprintWorkItems.sprintId],
    references: [sprints.id],
  }),
  workItem: one(workItems, {
    fields: [sprintWorkItems.workItemId],
    references: [workItems.id],
  }),
}));

// Milestone Relations
export const milestonesRelations = relations(milestones, ({ one, many }) => ({
  project: one(projects, {
    fields: [milestones.projectId],
    references: [projects.id],
  }),
  organization: one(organization, {
    fields: [milestones.organizationId],
    references: [organization.id],
  }),
  createdByUser: one(user, {
    fields: [milestones.createdByUserId],
    references: [user.id],
  }),
  milestoneWorkItems: many(milestoneWorkItems),
}));

export const milestoneWorkItemsRelations = relations(milestoneWorkItems, ({ one }) => ({
  milestone: one(milestones, {
    fields: [milestoneWorkItems.milestoneId],
    references: [milestones.id],
  }),
  workItem: one(workItems, {
    fields: [milestoneWorkItems.workItemId],
    references: [workItems.id],
  }),
}));

// Document Relations
export const documentCategoriesRelations = relations(documentCategories, ({ one, many }) => ({
  organization: one(organization, {
    fields: [documentCategories.organizationId],
    references: [organization.id],
  }),
  parent: one(documentCategories, {
    fields: [documentCategories.parentId],
    references: [documentCategories.id],
    relationName: "categoryParentChild",
  }),
  children: many(documentCategories, { relationName: "categoryParentChild" }),
  documents: many(documents),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  category: one(documentCategories, {
    fields: [documents.categoryId],
    references: [documentCategories.id],
  }),
  project: one(projects, {
    fields: [documents.projectId],
    references: [projects.id],
  }),
  documentWorkItems: many(documentWorkItems),
  sprintDocuments: many(sprintDocuments),
  versions: many(documentVersions),
  documentReads: many(documentReads),
  documentFavorites: many(documentFavorites),
}));

// Document Read Relations
export const documentReadsRelations = relations(documentReads, ({ one }) => ({
  document: one(documents, {
    fields: [documentReads.documentId],
    references: [documents.id],
  }),
  user: one(user, {
    fields: [documentReads.userId],
    references: [user.id],
  }),
}));

// Document Favorite Relations
export const documentFavoritesRelations = relations(documentFavorites, ({ one }) => ({
  document: one(documents, {
    fields: [documentFavorites.documentId],
    references: [documents.id],
  }),
  user: one(user, {
    fields: [documentFavorites.userId],
    references: [user.id],
  }),
}));

// Sprint-Document Relations
export const sprintDocumentsRelations = relations(sprintDocuments, ({ one }) => ({
  sprint: one(sprints, {
    fields: [sprintDocuments.sprintId],
    references: [sprints.id],
  }),
  document: one(documents, {
    fields: [sprintDocuments.documentId],
    references: [documents.id],
  }),
}));

// Document Version Relations
export const documentVersionsRelations = relations(documentVersions, ({ one }) => ({
  document: one(documents, {
    fields: [documentVersions.documentId],
    references: [documents.id],
  }),
}));

// Document-WorkItem Relations
export const documentWorkItemsRelations = relations(documentWorkItems, ({ one }) => ({
  document: one(documents, {
    fields: [documentWorkItems.documentId],
    references: [documents.id],
  }),
  workItem: one(workItems, {
    fields: [documentWorkItems.workItemId],
    references: [workItems.id],
  }),
}));

// GitHub Relations
export const repoInstallationLinksRelations = relations(repoInstallationLinks, ({ one }) => ({
  repo: one(projectRepositories, {
    fields: [repoInstallationLinks.repoId],
    references: [projectRepositories.id],
  }),
  connection: one(providerConnections, {
    fields: [repoInstallationLinks.connectionId],
    references: [providerConnections.id],
  }),
}));

export const githubCommitsRelations = relations(githubCommits, ({ one, many }) => ({
  repo: one(projectRepositories, {
    fields: [githubCommits.repoId],
    references: [projectRepositories.id],
  }),
  workItemCommits: many(workItemCommits, { relationName: "commitWorkItems" }),
}));

export const githubPullRequestsRelations = relations(githubPullRequests, ({ one }) => ({
  repo: one(projectRepositories, {
    fields: [githubPullRequests.repoId],
    references: [projectRepositories.id],
  }),
}));

export const githubWorkflowRunsRelations = relations(githubWorkflowRuns, ({ one }) => ({
  repo: one(projectRepositories, {
    fields: [githubWorkflowRuns.repoId],
    references: [projectRepositories.id],
  }),
}));

export const githubEventsRelations = relations(githubEvents, ({ one }) => ({
  repo: one(projectRepositories, {
    fields: [githubEvents.repoId],
    references: [projectRepositories.id],
  }),
}));

// Saved View Relations
export const savedViewsRelations = relations(savedViews, ({ one }) => ({
  user: one(user, {
    fields: [savedViews.userId],
    references: [user.id],
  }),
  board: one(boards, {
    fields: [savedViews.boardId],
    references: [boards.id],
  }),
}));

// AI Conversation Relations
export const aiConversationsRelations = relations(aiConversations, ({ one }) => ({
  project: one(projects, {
    fields: [aiConversations.projectId],
    references: [projects.id],
  }),
  board: one(boards, {
    fields: [aiConversations.boardId],
    references: [boards.id],
  }),
}));

// Provider Connection Relations
export const providerConnectionsRelations = relations(providerConnections, ({ one, many }) => ({
  createdByUser: one(user, {
    fields: [providerConnections.createdByUserId],
    references: [user.id],
  }),
  repoLinks: many(repoInstallationLinks),
}));

// Feedback Relations
export const feedbackSourcesRelations = relations(feedbackSources, ({ many }) => ({
  feedbackItems: many(feedbackItems),
}));

export const feedbackItemsRelations = relations(feedbackItems, ({ one, many }) => ({
  source: one(feedbackSources, {
    fields: [feedbackItems.sourceId],
    references: [feedbackSources.id],
  }),
  cluster: one(feedbackClusters, {
    fields: [feedbackItems.clusterId],
    references: [feedbackClusters.id],
  }),
  topic: one(feedbackTopics, {
    fields: [feedbackItems.topicId],
    references: [feedbackTopics.id],
  }),
  promotedWorkItem: one(workItems, {
    fields: [feedbackItems.promotedWorkItemId],
    references: [workItems.id],
  }),
  feedbackPromotions: many(feedbackPromotions),
  ideaItemLinks: many(ideaItemFeedbackLinks),
  seedFeedbackLinks: many(seedFeedbackLinks),
  bugFixAttempts: many(bugFixAttempts),
}));

export const feedbackClustersRelations = relations(feedbackClusters, ({ one, many }) => ({
  topic: one(feedbackTopics, {
    fields: [feedbackClusters.topicId],
    references: [feedbackTopics.id],
  }),
  feedbackItems: many(feedbackItems),
  bugFixAttempts: many(bugFixAttempts),
  resolvedByAttempt: one(bugFixAttempts, {
    relationName: "resolvedByAttempt",
    fields: [feedbackClusters.resolvedByAttemptId],
    references: [bugFixAttempts.id],
  }),
  statusHistory: many(clusterStatusHistory),
}));

export const feedbackTopicsRelations = relations(feedbackTopics, ({ one, many }) => ({
  parentTopic: one(feedbackTopics, {
    fields: [feedbackTopics.parentTopicId],
    references: [feedbackTopics.id],
    relationName: "topicParent",
  }),
  childTopics: many(feedbackTopics, { relationName: "topicParent" }),
  mergedIntoTopic: one(feedbackTopics, {
    fields: [feedbackTopics.mergedIntoTopicId],
    references: [feedbackTopics.id],
    relationName: "topicMergedInto",
  }),
  clusters: many(feedbackClusters),
  items: many(feedbackItems),
}));

// Feedback Topic Proposal Relations
export const feedbackTopicProposalsRelations = relations(feedbackTopicProposals, ({ one }) => ({
  topic: one(feedbackTopics, {
    fields: [feedbackTopicProposals.topicId],
    references: [feedbackTopics.id],
  }),
}));

export const feedbackPromotionsRelations = relations(feedbackPromotions, ({ one }) => ({
  feedbackItem: one(feedbackItems, {
    fields: [feedbackPromotions.feedbackItemId],
    references: [feedbackItems.id],
  }),
  workItem: one(workItems, {
    fields: [feedbackPromotions.workItemId],
    references: [workItems.id],
  }),
}));

// Bug Fix Attempt Relations
export const bugFixAttemptsRelations = relations(bugFixAttempts, ({ one, many }) => ({
  feedbackItem: one(feedbackItems, {
    fields: [bugFixAttempts.feedbackItemId],
    references: [feedbackItems.id],
  }),
  cluster: one(feedbackClusters, {
    fields: [bugFixAttempts.clusterId],
    references: [feedbackClusters.id],
  }),
  project: one(projects, {
    fields: [bugFixAttempts.projectId],
    references: [projects.id],
  }),
  agentJob: one(agentJobs, {
    fields: [bugFixAttempts.agentJobId],
    references: [agentJobs.id],
  }),
  // Reverse lookup — clusters whose resolution was attributed to this attempt.
  resolvedClusters: many(feedbackClusters, { relationName: "resolvedByAttempt" }),
}));

// Cluster Status History Relations
export const clusterStatusHistoryRelations = relations(
  clusterStatusHistory,
  ({ one }) => ({
    cluster: one(feedbackClusters, {
      fields: [clusterStatusHistory.clusterId],
      references: [feedbackClusters.id],
    }),
    triggeredByUser: one(user, {
      fields: [clusterStatusHistory.triggeredByUserId],
      references: [user.id],
    }),
    triggeredByAttempt: one(bugFixAttempts, {
      fields: [clusterStatusHistory.triggeredByAttemptId],
      references: [bugFixAttempts.id],
    }),
    triggeredByAgentJob: one(agentJobs, {
      fields: [clusterStatusHistory.triggeredByAgentJobId],
      references: [agentJobs.id],
    }),
  })
);

// Ideas Hub Relations
export const ideaItemsRelations = relations(ideaItems, ({ one, many }) => ({
  organization: one(organization, {
    fields: [ideaItems.organizationId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [ideaItems.projectId],
    references: [projects.id],
  }),
  owner: one(user, {
    fields: [ideaItems.ownerUserId],
    references: [user.id],
    relationName: "ideaItemOwner",
  }),
  createdByUser: one(user, {
    fields: [ideaItems.createdByUserId],
    references: [user.id],
    relationName: "ideaItemCreatedBy",
  }),
  feedbackLinks: many(ideaItemFeedbackLinks),
  workItemLinks: many(ideaItemWorkItemLinks),
  ideaItemTags: many(ideaItemTags),
  events: many(ideaItemEvents),
  comments: many(ideaItemComments),
}));

export const ideaItemFeedbackLinksRelations = relations(ideaItemFeedbackLinks, ({ one }) => ({
  ideaItem: one(ideaItems, {
    fields: [ideaItemFeedbackLinks.ideaItemId],
    references: [ideaItems.id],
  }),
  feedbackItem: one(feedbackItems, {
    fields: [ideaItemFeedbackLinks.feedbackItemId],
    references: [feedbackItems.id],
  }),
}));

export const ideaItemWorkItemLinksRelations = relations(ideaItemWorkItemLinks, ({ one }) => ({
  ideaItem: one(ideaItems, {
    fields: [ideaItemWorkItemLinks.ideaItemId],
    references: [ideaItems.id],
  }),
  workItem: one(workItems, {
    fields: [ideaItemWorkItemLinks.workItemId],
    references: [workItems.id],
  }),
  createdByUser: one(user, {
    fields: [ideaItemWorkItemLinks.createdBy],
    references: [user.id],
  }),
}));

export const ideaItemEventsRelations = relations(ideaItemEvents, ({ one }) => ({
  ideaItem: one(ideaItems, {
    fields: [ideaItemEvents.ideaItemId],
    references: [ideaItems.id],
  }),
  triggeredByUser: one(user, {
    fields: [ideaItemEvents.triggeredByUserId],
    references: [user.id],
  }),
}));

export const ideaItemCommentsRelations = relations(ideaItemComments, ({ one, many }) => ({
  ideaItem: one(ideaItems, {
    fields: [ideaItemComments.ideaItemId],
    references: [ideaItems.id],
  }),
  author: one(user, {
    fields: [ideaItemComments.userId],
    references: [user.id],
  }),
  mentions: many(commentMentions),
}));

export const commentMentionsRelations = relations(commentMentions, ({ one }) => ({
  comment: one(ideaItemComments, {
    fields: [commentMentions.commentId],
    references: [ideaItemComments.id],
  }),
  mentionedUser: one(user, {
    fields: [commentMentions.mentionedUserId],
    references: [user.id],
  }),
  ideaItem: one(ideaItems, {
    fields: [commentMentions.ideaItemId],
    references: [ideaItems.id],
  }),
}));

export const ideaItemTagsRelations = relations(ideaItemTags, ({ one }) => ({
  ideaItem: one(ideaItems, {
    fields: [ideaItemTags.ideaItemId],
    references: [ideaItems.id],
  }),
  tag: one(tags, {
    fields: [ideaItemTags.tagId],
    references: [tags.id],
  }),
}));

// Seed Relations
export const seedsRelations = relations(seeds, ({ one, many }) => ({
  organization: one(organization, {
    fields: [seeds.organizationId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [seeds.projectId],
    references: [projects.id],
  }),
  owner: one(user, {
    fields: [seeds.ownerUserId],
    references: [user.id],
    relationName: "seedOwner",
  }),
  createdByUser: one(user, {
    fields: [seeds.createdByUserId],
    references: [user.id],
    relationName: "seedCreatedBy",
  }),
  seedTags: many(seedTags),
  feedbackLinks: many(seedFeedbackLinks),
  workItemLinks: many(seedWorkItemLinks),
  planningSessionSeeds: many(planningSessionSeeds),
}));

export const seedTagsRelations = relations(seedTags, ({ one }) => ({
  seed: one(seeds, {
    fields: [seedTags.seedId],
    references: [seeds.id],
  }),
  tag: one(tags, {
    fields: [seedTags.tagId],
    references: [tags.id],
  }),
}));

export const seedFeedbackLinksRelations = relations(seedFeedbackLinks, ({ one }) => ({
  seed: one(seeds, {
    fields: [seedFeedbackLinks.seedId],
    references: [seeds.id],
  }),
  feedbackItem: one(feedbackItems, {
    fields: [seedFeedbackLinks.feedbackItemId],
    references: [feedbackItems.id],
  }),
}));

export const seedWorkItemLinksRelations = relations(seedWorkItemLinks, ({ one }) => ({
  seed: one(seeds, {
    fields: [seedWorkItemLinks.seedId],
    references: [seeds.id],
  }),
  workItem: one(workItems, {
    fields: [seedWorkItemLinks.workItemId],
    references: [workItems.id],
  }),
  createdByUser: one(user, {
    fields: [seedWorkItemLinks.createdBy],
    references: [user.id],
  }),
}));

// Planning Session Relations
export const planningSessionsRelations = relations(planningSessions, ({ one, many }) => ({
  organization: one(organization, {
    fields: [planningSessions.organizationId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [planningSessions.projectId],
    references: [projects.id],
  }),
  board: one(boards, {
    fields: [planningSessions.boardId],
    references: [boards.id],
  }),
  createdByUser: one(user, {
    fields: [planningSessions.createdByUserId],
    references: [user.id],
  }),
  sessionSeeds: many(planningSessionSeeds),
  sessionWorkItems: many(planningSessionWorkItems),
  agentJobs: many(agentJobs),
}));

export const planningSessionSeedsRelations = relations(planningSessionSeeds, ({ one }) => ({
  session: one(planningSessions, {
    fields: [planningSessionSeeds.sessionId],
    references: [planningSessions.id],
  }),
  seed: one(seeds, {
    fields: [planningSessionSeeds.seedId],
    references: [seeds.id],
  }),
}));

export const planningSessionWorkItemsRelations = relations(planningSessionWorkItems, ({ one }) => ({
  session: one(planningSessions, {
    fields: [planningSessionWorkItems.sessionId],
    references: [planningSessions.id],
  }),
  workItem: one(workItems, {
    fields: [planningSessionWorkItems.workItemId],
    references: [workItems.id],
  }),
}));

// Integration Batch Relations
export const integrationBatchesRelations = relations(integrationBatches, ({ one, many }) => ({
  organization: one(organization, {
    fields: [integrationBatches.organizationId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [integrationBatches.projectId],
    references: [projects.id],
  }),
  repository: one(projectRepositories, {
    fields: [integrationBatches.repositoryId],
    references: [projectRepositories.id],
  }),
  board: one(boards, {
    fields: [integrationBatches.boardId],
    references: [boards.id],
  }),
  triggeredByUser: one(user, {
    fields: [integrationBatches.triggeredByUserId],
    references: [user.id],
  }),
  items: many(integrationBatchItems),
}));

export const integrationBatchItemsRelations = relations(integrationBatchItems, ({ one }) => ({
  batch: one(integrationBatches, {
    fields: [integrationBatchItems.batchId],
    references: [integrationBatches.id],
  }),
  workItem: one(workItems, {
    fields: [integrationBatchItems.workItemId],
    references: [workItems.id],
  }),
}));

export const todoItemTagsRelations = relations(todoItemTags, ({ one }) => ({
  todoItem: one(todoItems, {
    fields: [todoItemTags.todoItemId],
    references: [todoItems.id],
  }),
  tag: one(tags, {
    fields: [todoItemTags.tagId],
    references: [tags.id],
  }),
}));

// Entity Comments Relations (polymorphic)
export const entityCommentsRelations = relations(entityComments, ({ one }) => ({
  author: one(user, {
    fields: [entityComments.userId],
    references: [user.id],
  }),
}));

// Todo Items Relations
export const todoItemsRelations = relations(todoItems, ({ one, many }) => ({
  organization: one(organization, {
    fields: [todoItems.organizationId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [todoItems.projectId],
    references: [projects.id],
  }),
  owner: one(user, {
    fields: [todoItems.ownerUserId],
    references: [user.id],
    relationName: "todoItemOwner",
  }),
  createdByUser: one(user, {
    fields: [todoItems.createdByUserId],
    references: [user.id],
    relationName: "todoItemCreatedBy",
  }),
  todoItemTags: many(todoItemTags),
}));

// Entity Events Relations (polymorphic audit trail)
export const entityEventsRelations = relations(entityEvents, ({ one }) => ({
  triggeredByUser: one(user, {
    fields: [entityEvents.triggeredByUserId],
    references: [user.id],
  }),
}));

// Onboarding Status Relations
export const onboardingStatusRelations = relations(onboardingStatus, ({ one }) => ({
  user: one(user, {
    fields: [onboardingStatus.userId],
    references: [user.id],
  }),
}));

// Onboarding Events Relations
export const onboardingEventsRelations = relations(onboardingEvents, ({ one }) => ({
  user: one(user, {
    fields: [onboardingEvents.userId],
    references: [user.id],
  }),
}));

// Quota Relations
export const providerQuotasRelations = relations(providerQuotas, ({ one, many }) => ({
  organization: one(organization, {
    fields: [providerQuotas.organizationId],
    references: [organization.id],
  }),
  alerts: many(quotaAlerts),
}));

export const quotaAlertsRelations = relations(quotaAlerts, ({ one }) => ({
  providerQuota: one(providerQuotas, {
    fields: [quotaAlerts.providerQuotaId],
    references: [providerQuotas.id],
  }),
}));

// Import Job Relations
export const importJobsRelations = relations(importJobs, ({ one }) => ({
  organization: one(organization, {
    fields: [importJobs.organizationId],
    references: [organization.id],
  }),
}));

// API Key Relations
export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  organization: one(organization, {
    fields: [apiKeys.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [apiKeys.userId],
    references: [user.id],
  }),
  serviceAccount: one(serviceAccounts, {
    fields: [apiKeys.serviceAccountId],
    references: [serviceAccounts.id],
  }),
}));

// Service Account Relations
export const serviceAccountsRelations = relations(serviceAccounts, ({ one, many }) => ({
  organization: one(organization, {
    fields: [serviceAccounts.organizationId],
    references: [organization.id],
  }),
  apiKeys: many(apiKeys),
}));

// Task ID Counter Relations
export const taskIdCountersRelations = relations(taskIdCounters, ({ one }) => ({
  organization: one(organization, {
    fields: [taskIdCounters.organizationId],
    references: [organization.id],
  }),
}));

// Organization Settings Relations
export const organizationSettingsRelations = relations(organizationSettings, ({ one }) => ({
  organization: one(organization, {
    fields: [organizationSettings.organizationId],
    references: [organization.id],
  }),
}));

// Organization Relations
export const organizationRelations = relations(organization, ({ one, many }) => ({
  settings: one(organizationSettings),
  members: many(member),
  invitations: many(invitation),
  projects: many(projects),
  boards: many(boards),
  tags: many(tags),
  webhooks: many(webhooks),
  importJobs: many(importJobs),
  apiKeys: many(apiKeys),
  serviceAccounts: many(serviceAccounts),
  documentCategories: many(documentCategories),
  taskIdCounters: many(taskIdCounters),
  providerQuotas: many(providerQuotas),
  providerConnections: many(providerConnections),
  discordConnections: many(discordConnections),
  ideaItems: many(ideaItems),
  todoItems: many(todoItems),
  seeds: many(seeds),
  scheduledAgentConfigs: many(scheduledAgentConfigs),
  skills: many(skills),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  inviter: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

// Waitlist Relations
export const waitlistUsersRelations = relations(waitlistUsers, ({ many }) => ({
  referralsSent: many(waitlistReferrals, { relationName: "waitlistReferralsSent" }),
  referralReceived: many(waitlistReferrals, { relationName: "waitlistReferralsReceived" }),
  actions: many(waitlistActions),
  emailTokens: many(waitlistEmailTokens),
  thankYouSends: many(waitlistThankYouSends),
}));

export const waitlistReferralsRelations = relations(waitlistReferrals, ({ one }) => ({
  referrer: one(waitlistUsers, {
    fields: [waitlistReferrals.referrerUserId],
    references: [waitlistUsers.id],
    relationName: "waitlistReferralsSent",
  }),
  referred: one(waitlistUsers, {
    fields: [waitlistReferrals.referredUserId],
    references: [waitlistUsers.id],
    relationName: "waitlistReferralsReceived",
  }),
}));

export const waitlistActionsRelations = relations(waitlistActions, ({ one }) => ({
  user: one(waitlistUsers, {
    fields: [waitlistActions.userId],
    references: [waitlistUsers.id],
  }),
}));

export const waitlistEmailTokensRelations = relations(waitlistEmailTokens, ({ one }) => ({
  user: one(waitlistUsers, {
    fields: [waitlistEmailTokens.userId],
    references: [waitlistUsers.id],
  }),
}));

export const waitlistThankYouSendsRelations = relations(waitlistThankYouSends, ({ one }) => ({
  user: one(waitlistUsers, {
    fields: [waitlistThankYouSends.userId],
    references: [waitlistUsers.id],
  }),
  sentByUser: one(user, {
    fields: [waitlistThankYouSends.sentByUserId],
    references: [user.id],
  }),
}));

// User View Preferences Relations
export const userViewPreferencesRelations = relations(userViewPreferences, ({ one }) => ({
  user: one(user, {
    fields: [userViewPreferences.userId],
    references: [user.id],
  }),
}));

// Notification Relations
export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipientUser: one(user, {
    fields: [notifications.recipientUserId],
    references: [user.id],
    relationName: "notificationRecipient",
  }),
  actorUser: one(user, {
    fields: [notifications.actorUserId],
    references: [user.id],
    relationName: "notificationActor",
  }),
}));

export const notificationPreferencesRelations = relations(notificationPreferences, ({ one }) => ({
  user: one(user, {
    fields: [notificationPreferences.userId],
    references: [user.id],
  }),
}));

// Expense Category Relations
export const expenseCategoriesRelations = relations(expenseCategories, ({ one, many }) => ({
  organization: one(organization, {
    fields: [expenseCategories.organizationId],
    references: [organization.id],
  }),
  parent: one(expenseCategories, {
    fields: [expenseCategories.parentId],
    references: [expenseCategories.id],
    relationName: "expenseCategoryParentChild",
  }),
  children: many(expenseCategories, { relationName: "expenseCategoryParentChild" }),
  expenses: many(expenses),
  recurringExpenses: many(recurringExpenses),
}));

// Expense Relations
export const expensesRelations = relations(expenses, ({ one, many }) => ({
  organization: one(organization, {
    fields: [expenses.organizationId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [expenses.projectId],
    references: [projects.id],
  }),
  category: one(expenseCategories, {
    fields: [expenses.categoryId],
    references: [expenseCategories.id],
  }),
  paidByUser: one(user, {
    fields: [expenses.paidByUserId],
    references: [user.id],
    relationName: "expensePaidByUser",
  }),
  recurringExpense: one(recurringExpenses, {
    fields: [expenses.recurringExpenseId],
    references: [recurringExpenses.id],
  }),
  expenseTags: many(expenseTags),
}));

// Expense Tag Relations
export const expenseTagsRelations = relations(expenseTags, ({ one }) => ({
  expense: one(expenses, {
    fields: [expenseTags.expenseId],
    references: [expenses.id],
  }),
  tag: one(tags, {
    fields: [expenseTags.tagId],
    references: [tags.id],
  }),
}));

// Recurring Expense Relations
export const recurringExpensesRelations = relations(recurringExpenses, ({ one, many }) => ({
  organization: one(organization, {
    fields: [recurringExpenses.organizationId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [recurringExpenses.projectId],
    references: [projects.id],
  }),
  category: one(expenseCategories, {
    fields: [recurringExpenses.categoryId],
    references: [expenseCategories.id],
  }),
  paidByUser: one(user, {
    fields: [recurringExpenses.paidByUserId],
    references: [user.id],
    relationName: "recurringExpensePaidByUser",
  }),
  expenses: many(expenses),
}));

// Usage Relations
export const usageRecordsRelations = relations(usageRecords, ({ one }) => ({
  organization: one(organization, {
    fields: [usageRecords.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [usageRecords.userId],
    references: [user.id],
  }),
  project: one(projects, {
    fields: [usageRecords.projectId],
    references: [projects.id],
  }),
}));

export const usageSummariesRelations = relations(usageSummaries, ({ one }) => ({
  organization: one(organization, {
    fields: [usageSummaries.organizationId],
    references: [organization.id],
  }),
}));

export const userUsageSummariesRelations = relations(userUsageSummaries, ({ one }) => ({
  organization: one(organization, {
    fields: [userUsageSummaries.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [userUsageSummaries.userId],
    references: [user.id],
  }),
}));

// Discord Relations
export const discordConnectionsRelations = relations(discordConnections, ({ one, many }) => ({
  organization: one(organization, {
    fields: [discordConnections.organizationId],
    references: [organization.id],
  }),
  projectChannels: many(discordProjectChannels),
  notificationPreferences: many(discordNotificationPreferences),
}));

export const discordProjectChannelsRelations = relations(discordProjectChannels, ({ one }) => ({
  discordConnection: one(discordConnections, {
    fields: [discordProjectChannels.discordConnectionId],
    references: [discordConnections.id],
  }),
  project: one(projects, {
    fields: [discordProjectChannels.projectId],
    references: [projects.id],
  }),
}));

export const discordNotificationPreferencesRelations = relations(discordNotificationPreferences, ({ one }) => ({
  discordConnection: one(discordConnections, {
    fields: [discordNotificationPreferences.discordConnectionId],
    references: [discordConnections.id],
  }),
  project: one(projects, {
    fields: [discordNotificationPreferences.projectId],
    references: [projects.id],
  }),
}));

// Scheduled Agent Config Relations
export const scheduledAgentConfigsRelations = relations(scheduledAgentConfigs, ({ one, many }) => ({
  organization: one(organization, {
    fields: [scheduledAgentConfigs.organizationId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [scheduledAgentConfigs.projectId],
    references: [projects.id],
  }),
  runs: many(scheduledAgentRuns),
}));

// Scheduled Agent Run Relations
export const scheduledAgentRunsRelations = relations(scheduledAgentRuns, ({ one }) => ({
  config: one(scheduledAgentConfigs, {
    fields: [scheduledAgentRuns.configId],
    references: [scheduledAgentConfigs.id],
  }),
  organization: one(organization, {
    fields: [scheduledAgentRuns.organizationId],
    references: [organization.id],
  }),
}));

// Skills Relations
export const skillsRelations = relations(skills, ({ one }) => ({
  organization: one(organization, {
    fields: [skills.organizationId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [skills.projectId],
    references: [projects.id],
  }),
  createdByUser: one(user, {
    fields: [skills.createdByUserId],
    references: [user.id],
  }),
}));

// Project Members Relations
export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
  user: one(user, {
    fields: [projectMembers.userId],
    references: [user.id],
  }),
}));

// Agent Observations Relations
export const agentObservationsRelations = relations(agentObservations, ({ one }) => ({
  organization: one(organization, {
    fields: [agentObservations.organizationId],
    references: [organization.id],
  }),
  project: one(projects, {
    fields: [agentObservations.projectId],
    references: [projects.id],
  }),
  agentJob: one(agentJobs, {
    fields: [agentObservations.agentJobId],
    references: [agentJobs.id],
  }),
}));
