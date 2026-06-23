import { db } from "../../client";
import { workItemCommits, githubCommits, workItems } from "../../schema";
import { eq, and } from "drizzle-orm";

export interface CommitWithLink {
  id: string;
  workItemId: string;
  commitId: string;
  autoLinked: boolean;
  createdAt: Date;
  commit: {
    id: string;
    repoId: string;
    sha: string;
    message: string;
    authorLogin: string | null;
    authorName: string | null;
    authorAvatarUrl: string | null;
    branch: string | null;
    additions: number | null;
    deletions: number | null;
    committedAt: Date;
  };
}

export interface WorkItemWithLink {
  id: string;
  workItemId: string;
  commitId: string;
  autoLinked: boolean;
  createdAt: Date;
  workItem: {
    id: string;
    taskId: string | null;
    title: string;
    type: string;
    priority: string;
  };
}

// Link a commit to a work item (idempotent via onConflictDoNothing)
export const linkCommitToWorkItem = async (
  workItemId: string,
  commitId: string,
  autoLinked: boolean = true
) => {
  const results = await db
    .insert(workItemCommits)
    .values({ workItemId, commitId, autoLinked })
    .onConflictDoNothing({
      target: [workItemCommits.workItemId, workItemCommits.commitId],
    })
    .returning();

  return results[0] ?? null;
};

// Unlink a commit from a work item
export const unlinkCommitFromWorkItem = async (
  workItemId: string,
  commitId: string
): Promise<boolean> => {
  const result = await db
    .delete(workItemCommits)
    .where(
      and(
        eq(workItemCommits.workItemId, workItemId),
        eq(workItemCommits.commitId, commitId)
      )
    )
    .returning();

  return result.length > 0;
};

// Get all commits linked to a work item (with full commit data)
export const getCommitsByWorkItemId = async (
  workItemId: string
): Promise<CommitWithLink[]> => {
  const results = await db
    .select({
      id: workItemCommits.id,
      workItemId: workItemCommits.workItemId,
      commitId: workItemCommits.commitId,
      autoLinked: workItemCommits.autoLinked,
      createdAt: workItemCommits.createdAt,
      commit: {
        id: githubCommits.id,
        repoId: githubCommits.repoId,
        sha: githubCommits.sha,
        message: githubCommits.message,
        authorLogin: githubCommits.authorLogin,
        authorName: githubCommits.authorName,
        authorAvatarUrl: githubCommits.authorAvatarUrl,
        branch: githubCommits.branch,
        additions: githubCommits.additions,
        deletions: githubCommits.deletions,
        committedAt: githubCommits.committedAt,
      },
    })
    .from(workItemCommits)
    .innerJoin(githubCommits, eq(workItemCommits.commitId, githubCommits.id))
    .where(eq(workItemCommits.workItemId, workItemId));

  return results;
};

// Get all work items linked to a commit (with basic work item data)
export const getWorkItemsByCommitId = async (
  commitId: string
): Promise<WorkItemWithLink[]> => {
  const results = await db
    .select({
      id: workItemCommits.id,
      workItemId: workItemCommits.workItemId,
      commitId: workItemCommits.commitId,
      autoLinked: workItemCommits.autoLinked,
      createdAt: workItemCommits.createdAt,
      workItem: {
        id: workItems.id,
        taskId: workItems.taskId,
        title: workItems.title,
        type: workItems.type,
        priority: workItems.priority,
      },
    })
    .from(workItemCommits)
    .innerJoin(workItems, eq(workItemCommits.workItemId, workItems.id))
    .where(eq(workItemCommits.commitId, commitId));

  return results;
};
