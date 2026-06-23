import { logger } from "@almirant/config";
import { db, eq, workItems, sql } from "@almirant/database";
import {
  parseGithubPrUrl,
  updatePrDescriptionWithPreviewUrl,
} from "../../github/services/github-service";

/**
 * Represents a parsed Coolify deployment notification.
 */
interface CoolifyDeploymentInfo {
  previewUrl: string;
  prNumber: string | null;
  branch: string | null;
  isSuccess: boolean;
  isPreview: boolean;
}

/**
 * Parse a Coolify Slack Block Kit payload to extract deployment information.
 *
 * Coolify sends notifications in Slack Block Kit format with:
 * - `blocks[]` containing section blocks with `text.text` fields
 * - `attachments[]` with a `color` field indicating success/failure
 *
 * Preview URLs typically follow the pattern: `pr{number}.domain.com` or contain
 * branch information in the URL or text content.
 */
export const parseCoolifyPayload = (
  payload: Record<string, unknown>
): CoolifyDeploymentInfo | null => {
  try {
    // Extract status from attachments color
    const attachments = payload.attachments as
      | Array<{ color?: string; text?: string }>
      | undefined;
    const color = attachments?.[0]?.color;

    // Green colors indicate success
    const isSuccess =
      color === "#36a64f" || color === "#00ff00" || color === "good";

    // Extract text content from blocks and attachments to find URLs
    const allText = extractAllText(payload);

    // Extract URLs from the text content
    const urls = extractUrls(allText);

    if (urls.length === 0) {
      logger.debug("Coolify webhook: no URLs found in payload");
      return null;
    }

    // Determine if this is a preview deployment and extract PR/branch info
    let previewUrl: string | null = null;
    let prNumber: string | null = null;
    let branch: string | null = null;
    let isPreview = false;

    for (const url of urls) {
      const prMatch = extractPrFromUrl(url);
      if (prMatch) {
        previewUrl = url;
        prNumber = prMatch;
        isPreview = true;
        break;
      }
    }

    // If no PR pattern in URL, check text content for PR/branch references
    if (!isPreview) {
      const prFromText = extractPrFromText(allText);
      if (prFromText) {
        prNumber = prFromText;
        isPreview = true;
        previewUrl = urls[0] ?? null;
      }

      const branchFromText = extractBranchFromText(allText);
      if (branchFromText) {
        branch = branchFromText;
        // If branch is not main/master/production, it's a preview
        const productionBranches = ["main", "master", "production", "prod"];
        if (!productionBranches.includes(branchFromText.toLowerCase())) {
          isPreview = true;
          previewUrl = previewUrl ?? urls[0] ?? null;
        }
      }
    }

    if (!previewUrl) {
      return null;
    }

    return {
      previewUrl,
      prNumber,
      branch,
      isSuccess,
      isPreview,
    };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to parse Coolify webhook payload"
    );
    return null;
  }
};

/**
 * Extract all text content from the Slack Block Kit payload.
 */
const extractAllText = (payload: Record<string, unknown>): string => {
  const parts: string[] = [];

  // Text from blocks
  const blocks = payload.blocks as
    | Array<{
        type?: string;
        text?: { type?: string; text?: string } | string;
        fields?: Array<{ text?: string }>;
      }>
    | undefined;

  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (block.text) {
        if (typeof block.text === "string") {
          parts.push(block.text);
        } else if (block.text.text) {
          parts.push(block.text.text);
        }
      }
      if (Array.isArray(block.fields)) {
        for (const field of block.fields) {
          if (field.text) parts.push(field.text);
        }
      }
    }
  }

  // Text from attachments
  const attachments = payload.attachments as
    | Array<{ text?: string; pretext?: string; fallback?: string }>
    | undefined;

  if (Array.isArray(attachments)) {
    for (const attachment of attachments) {
      if (attachment.text) parts.push(attachment.text);
      if (attachment.pretext) parts.push(attachment.pretext);
      if (attachment.fallback) parts.push(attachment.fallback);
    }
  }

  // Top-level text field
  if (typeof payload.text === "string") {
    parts.push(payload.text);
  }

  return parts.join("\n");
};

/**
 * Extract URLs from text content, handling Slack-style `<url|label>` links.
 */
const extractUrls = (text: string): string[] => {
  const urls: string[] = [];

  // Slack-style links: <https://example.com|label> or <https://example.com>
  const slackLinkRegex = /<(https?:\/\/[^|>]+)(?:\|[^>]*)?>|/g;
  let match: RegExpExecArray | null;
  while ((match = slackLinkRegex.exec(text)) !== null) {
    if (match[1]) urls.push(match[1]);
  }

  // Plain URLs
  const plainUrlRegex = /(?<![<|])https?:\/\/[^\s>|)]+/g;
  while ((match = plainUrlRegex.exec(text)) !== null) {
    if (!urls.includes(match[0])) {
      urls.push(match[0]);
    }
  }

  return urls;
};

/**
 * Extract PR number from a URL following the pattern `pr{number}.domain` or
 * `{number}.domain` for preview deployments.
 */
const extractPrFromUrl = (url: string): string | null => {
  try {
    const hostname = new URL(url).hostname;
    // Match patterns like pr123.example.com or 123.example.com
    const prMatch = hostname.match(/^pr(\d+)\./i);
    if (prMatch) return prMatch[1] ?? null;

    const numMatch = hostname.match(/^(\d+)\./);
    if (numMatch) return numMatch[1] ?? null;

    return null;
  } catch {
    return null;
  }
};

/**
 * Extract PR number from text content (e.g., "PR #123", "Pull Request #123").
 */
const extractPrFromText = (text: string): string | null => {
  const prMatch = text.match(/(?:PR|pull\s*request)\s*#?(\d+)/i);
  return prMatch?.[1] ?? null;
};

/**
 * Extract branch name from text content (e.g., "Branch: feature/xyz").
 */
const extractBranchFromText = (text: string): string | null => {
  const branchMatch = text.match(
    /(?:branch|ref)[:\s]+[`*]?([a-zA-Z0-9_./-]+)[`*]?/i
  );
  return branchMatch?.[1] ?? null;
};

/**
 * Handle a successful Coolify preview deployment by storing the preview URL
 * on matching work items.
 */
export const handleCoolifyDeployment = async (
  payload: Record<string, unknown>
): Promise<void> => {
  const info = parseCoolifyPayload(payload);

  if (!info) {
    logger.info("Coolify webhook: could not extract deployment info from payload");
    return;
  }

  if (!info.isSuccess) {
    logger.info("Coolify webhook: deployment was not successful, ignoring");
    return;
  }

  if (!info.isPreview) {
    logger.info("Coolify webhook: production deployment, ignoring");
    return;
  }

  logger.info(
    {
      previewUrl: info.previewUrl,
      prNumber: info.prNumber,
      branch: info.branch,
    },
    "Coolify preview deployment succeeded, looking for matching work items"
  );

  const matchingItems = await storePreviewUrlOnWorkItems(info);

  // Fire-and-forget: update GitHub PR descriptions with preview link
  for (const item of matchingItems) {
    const metadata = item.metadata as Record<string, unknown> | null;
    const pullRequest = metadata?.pullRequest as Record<string, unknown> | undefined;
    const prUrl = pullRequest?.url as string | undefined;

    if (!prUrl) continue;

    const parsed = parseGithubPrUrl(prUrl);
    if (!parsed) continue;

    updatePrDescriptionWithPreviewUrl(
      info.previewUrl,
      parsed.prNumber,
      parsed.repoFullName
    ).catch((e) =>
      logger.error(
        { error: e instanceof Error ? e.message : String(e), prUrl },
        "Failed to update PR description with preview URL"
      )
    );
  }
};

/**
 * Find work items matching the PR number or branch and update their metadata
 * with the preview URL.
 */
const storePreviewUrlOnWorkItems = async (
  info: CoolifyDeploymentInfo
): Promise<Array<{ id: string; metadata: unknown }>> => {
  const { previewUrl, prNumber, branch } = info;

  // Build conditions to match work items by PR number or branch
  const conditions = [];

  if (prNumber) {
    conditions.push(
      sql`${workItems.metadata}->'pullRequest'->>'number' = ${prNumber}`
    );
  }

  if (branch) {
    conditions.push(
      sql`${workItems.metadata}->'pullRequest'->>'branch' = ${branch}`
    );
  }

  if (conditions.length === 0) {
    logger.info(
      "Coolify webhook: no PR number or branch to match work items against"
    );
    return [];
  }

  // Combine conditions with OR
  const whereClause =
    conditions.length === 1
      ? conditions[0]
      : sql`(${conditions[0]} OR ${conditions[1]})`;

  const matchingItems = await db
    .select({ id: workItems.id, metadata: workItems.metadata })
    .from(workItems)
    .where(whereClause);

  if (matchingItems.length === 0) {
    logger.info(
      { prNumber, branch },
      "Coolify webhook: no work items found matching PR/branch"
    );
    return [];
  }

  logger.info(
    { prNumber, branch, previewUrl, workItemCount: matchingItems.length },
    "Storing Coolify preview URL on matching work items"
  );

  for (const item of matchingItems) {
    const currentMetadata =
      (item.metadata as Record<string, unknown>) ?? {};
    const updatedMetadata = { ...currentMetadata, previewUrl };

    await db
      .update(workItems)
      .set({ metadata: updatedMetadata, updatedAt: new Date() })
      .where(eq(workItems.id, item.id));
  }

  return matchingItems;
};
