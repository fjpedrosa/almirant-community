import { Elysia, t } from "elysia";
import { validateApiKey, getGithubInstallationIdByRepoFullName, getRepoIdByGithubFullName, getWorkspaceIdByRepoId } from "@almirant/database";
import { logger } from "@almirant/config";
import { sessionAuthMiddleware } from "../../../../shared/middleware/session-auth.middleware";
import { errorResponse, successResponse } from "../../../../shared/services/response";
import { getInstallationAccessToken } from "../services/github-service";
import { autoLinkPrToWorkItems } from "../services/github-webhook-handlers";

const GITHUB_API_BASE = "https://api.github.com";

const extractWorkerApiKey = (request: Request): string | null => {
  const x = request.headers.get("x-api-key");
  if (x && x.trim()) return x.trim();

  // Allow Bearer API keys too (mc-worker uses Authorization for other endpoints).
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const raw = auth.slice(7).trim();
    if (raw) return raw;
  }

  return null;
};

const fetchGithub = async (args: {
  token: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: unknown;
}): Promise<Response> => {
  const url = args.path.startsWith("http") ? args.path : `${GITHUB_API_BASE}${args.path}`;
  return await fetch(url, {
    method: args.method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${args.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(args.body ? { "Content-Type": "application/json" } : {}),
    },
    body: args.body ? JSON.stringify(args.body) : undefined,
  });
};

const parseOwnerRepo = (repoFullName: string): { owner: string; repo: string } | null => {
  const parts = repoFullName.split("/");
  if (parts.length !== 2) return null;
  const owner = (parts[0] ?? "").trim();
  const repo = (parts[1] ?? "").trim();
  if (!owner || !repo) return null;
  return { owner, repo };
};

/**
 * Fire-and-forget helper: resolve org from repo name and link the PR to work items
 * by extracting task IDs from the PR title and branch name.
 */
const linkPrToWorkItems = (
  repoFullName: string,
  title: string,
  head: string,
  prUrl: string,
  prNumber: number,
): void => {
  getRepoIdByGithubFullName(repoFullName)
    .then((repoId) => (repoId ? getWorkspaceIdByRepoId(repoId) : null))
    .then((orgId) => {
      if (!orgId) return;
      return autoLinkPrToWorkItems(orgId, {
        title,
        head: { ref: head },
        html_url: prUrl,
        number: prNumber,
        merged: false,
        state: "open",
      });
    })
    .catch((e) =>
      logger.error(
        `[github-pr-route] Auto-link PR to work items failed: ${e instanceof Error ? e.message : String(e)}`
      )
    );
};

export const githubPullRequestsRoutes = new Elysia({ prefix: "/api/github" })
  .use(sessionAuthMiddleware)
  .post(
    "/pull-requests",
    async ({ body, request, set, user }) => {
      // Auth: allow either a valid session user OR a valid API key (workers).
      if (!user) {
        const rawKey = extractWorkerApiKey(request);
        if (!rawKey) {
          set.status = 401;
          return errorResponse("Unauthorized");
        }
        const apiKey = await validateApiKey(rawKey);
        if (!apiKey) {
          set.status = 401;
          return errorResponse("Unauthorized");
        }
      }

      const repoParsed = parseOwnerRepo(body.repoFullName);
      if (!repoParsed) {
        set.status = 400;
        return errorResponse("repoFullName must be in the format owner/repo");
      }

      const installationId = await getGithubInstallationIdByRepoFullName(body.repoFullName);
      if (!installationId) {
        set.status = 404;
        return errorResponse(`No GitHub installation linked for repoFullName=${body.repoFullName}`);
      }

      const token = await getInstallationAccessToken(installationId);

      const createRes = await fetchGithub({
        token,
        method: "POST",
        path: `/repos/${repoParsed.owner}/${repoParsed.repo}/pulls`,
        body: {
          title: body.title,
          head: body.head,
          base: body.base ?? "main",
          body: body.body ?? "",
          draft: body.isDraft ?? false,
        },
      });

      // 422: e.g. "A pull request already exists for ..."
      if (createRes.status === 422) {
        const headParam = `${repoParsed.owner}:${body.head}`;
        const listRes = await fetchGithub({
          token,
          method: "GET",
          path: `/repos/${repoParsed.owner}/${repoParsed.repo}/pulls?state=open&head=${encodeURIComponent(headParam)}`,
        });

        if (listRes.ok) {
          const prs = (await listRes.json()) as Array<{ html_url?: unknown; number?: unknown; id?: unknown }>;
          const first = prs[0];
          if (first && typeof first.html_url === "string" && typeof first.number === "number") {
            // Fire-and-forget: link existing PR to work items (ensures metadata is up-to-date)
            linkPrToWorkItems(body.repoFullName, body.title, body.head, first.html_url, first.number);

            set.status = 200;
            return successResponse({
              prUrl: first.html_url,
              prNumber: first.number,
              prId: typeof first.id === "number" ? String(first.id) : String(first.number),
              alreadyExists: true,
            });
          }
        }

        // No open PR found — check if the previous PR was merged/closed.
        // If so, report it so the caller can create a new PR later (after pushing commits).
        const allRes = await fetchGithub({
          token,
          method: "GET",
          path: `/repos/${repoParsed.owner}/${repoParsed.repo}/pulls?state=closed&head=${encodeURIComponent(headParam)}&sort=updated&direction=desc&per_page=1`,
        });

        if (allRes.ok) {
          const closedPrs = (await allRes.json()) as Array<{ html_url?: string; number?: number; state?: string; merged_at?: string | null }>;
          const latest = closedPrs[0];
          if (latest) {
            set.status = 200;
            return successResponse({
              previousPrCompleted: true,
              previousPrUrl: latest.html_url,
              previousPrNumber: latest.number,
              previousPrMerged: !!latest.merged_at,
            });
          }
        }

        set.status = 409;
        return errorResponse("Pull request already exists (HTTP 422)");
      }

      if (!createRes.ok) {
        const text = await createRes.text().catch(() => "");
        set.status = createRes.status;
        return errorResponse(`GitHub PR create failed: HTTP ${createRes.status} ${createRes.statusText}: ${text.slice(0, 500)}`);
      }

      const data = (await createRes.json()) as { html_url?: unknown; number?: unknown; id?: unknown };
      if (typeof data.html_url !== "string" || typeof data.number !== "number") {
        set.status = 502;
        return errorResponse("GitHub PR create returned unexpected payload");
      }

      // Fire-and-forget: immediately link PR to work items by task IDs in title/branch
      linkPrToWorkItems(body.repoFullName, body.title, body.head, data.html_url, data.number);

      set.status = 200;
      return successResponse({
        prUrl: data.html_url,
        prNumber: data.number,
        prId: typeof data.id === "number" ? String(data.id) : String(data.number),
      });
    },
    {
      body: t.Object({
        repoFullName: t.String(),
        head: t.String(),
        base: t.Optional(t.String()),
        title: t.String(),
        body: t.Optional(t.String()),
        isDraft: t.Optional(t.Boolean()),
      }),
    }
  )
  .patch(
    "/pull-requests/:prNumber",
    async ({ params, body, request, set, user }) => {
      if (!user) {
        const rawKey = extractWorkerApiKey(request);
        if (!rawKey) {
          set.status = 401;
          return errorResponse("Unauthorized");
        }
        const apiKey = await validateApiKey(rawKey);
        if (!apiKey) {
          set.status = 401;
          return errorResponse("Unauthorized");
        }
      }

      const repoParsed = parseOwnerRepo(body.repoFullName);
      if (!repoParsed) {
        set.status = 400;
        return errorResponse("repoFullName must be in the format owner/repo");
      }

      const installationId = await getGithubInstallationIdByRepoFullName(body.repoFullName);
      if (!installationId) {
        set.status = 404;
        return errorResponse(`No GitHub installation linked for repoFullName=${body.repoFullName}`);
      }

      const token = await getInstallationAccessToken(installationId);

      // GitHub REST API cannot convert draft → ready. Use GraphQL for that.
      if (body.draft === false) {
        // First, get the PR's node_id via REST
        const prRes = await fetchGithub({
          token,
          method: "GET",
          path: `/repos/${repoParsed.owner}/${repoParsed.repo}/pulls/${params.prNumber}`,
        });

        if (!prRes.ok) {
          const text = await prRes.text().catch(() => "");
          set.status = prRes.status;
          return errorResponse(`GitHub PR fetch failed: HTTP ${prRes.status}: ${text.slice(0, 500)}`);
        }

        const prData = (await prRes.json()) as { node_id?: string; draft?: boolean };

        if (prData.draft) {
          const mutation = `mutation($pullRequestId: ID!) {
            markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
              pullRequest { isDraft }
            }
          }`;

          const gqlRes = await fetch("https://api.github.com/graphql", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: mutation,
              variables: { pullRequestId: prData.node_id },
            }),
          });

          if (!gqlRes.ok) {
            const text = await gqlRes.text().catch(() => "");
            set.status = gqlRes.status;
            return errorResponse(`GitHub GraphQL markPullRequestReadyForReview failed: HTTP ${gqlRes.status}: ${text.slice(0, 500)}`);
          }

          const gqlData = (await gqlRes.json()) as { errors?: Array<{ message: string }> };
          if (gqlData.errors?.length) {
            set.status = 422;
            return errorResponse(`GitHub GraphQL error: ${gqlData.errors.map((e) => e.message).join(", ")}`);
          }
        }
      }

      // Apply remaining REST-compatible fields (title, body, draft: true)
      const patchBody: Record<string, unknown> = {};
      if (body.draft === true) patchBody.draft = true;
      if (typeof body.title === "string") patchBody.title = body.title;
      if (typeof body.body === "string") patchBody.body = body.body;
      if (body.state) patchBody.state = body.state;

      if (Object.keys(patchBody).length > 0) {
        const patchRes = await fetchGithub({
          token,
          method: "PATCH",
          path: `/repos/${repoParsed.owner}/${repoParsed.repo}/pulls/${params.prNumber}`,
          body: patchBody,
        });

        if (!patchRes.ok) {
          const text = await patchRes.text().catch(() => "");
          set.status = patchRes.status;
          return errorResponse(`GitHub PR update failed: HTTP ${patchRes.status}: ${text.slice(0, 500)}`);
        }
      }

      set.status = 200;
      return successResponse({ updated: true });
    },
    {
      params: t.Object({ prNumber: t.String() }),
      body: t.Object({
        repoFullName: t.String(),
        draft: t.Optional(t.Boolean()),
        title: t.Optional(t.String()),
        body: t.Optional(t.String()),
        state: t.Optional(t.Union([t.Literal("open"), t.Literal("closed")])),
      }),
    }
  );
