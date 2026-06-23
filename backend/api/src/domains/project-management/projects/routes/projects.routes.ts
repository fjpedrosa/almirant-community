import { Elysia, t } from "elysia";
import { sessionContextTypes } from "../../../../shared/middleware/session-context-types.plugin";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  transferProject,
  archiveProject,
  deleteProject,
  getDocLinks,
  createDocLink,
  updateDocLink,
  deleteDocLink,
  reorderDocLinks,
  getNotes,
  getNoteById,
  createNote,
  updateNote,
  deleteNote,
  reorderNotes,
  getAllBoards,
  getProjectNightlyValidation,
  updateProjectNightlyValidation,
  getProjectAiConfig,
  updateProjectAiConfig,
  getSkillConfig,
  updateSkillConfig,
  getRepositories,
  createRepository,
  updateRepository,
  deleteRepository,
  reorderRepositories,
  getAllGithubRepoUrls,
  getProjectRoadmap,
  getWorkItemStatsByType,
  linkRepoToInstallation,
  extractGithubRepoFullName,
  getGithubConnectionForOrganization,
  getUnlinkedGithubRepos,
  getDiscordConnectionByOrganization,
  getDiscordProjectChannel,
  upsertDiscordProjectChannel,
  getDiscordNotificationPreferences,
  upsertDiscordNotificationPreferences,
  deleteDiscordProjectNotificationPreferences,
  addProjectMember,
  removeProjectMember,
  getProjectMembers,
  db,
  schema,
  eq,
  and,
} from "@almirant/database";
import {
  successResponse,
  errorResponse,
  notFoundResponse,
  parsePaginationParams,
  buildPaginationMeta,
} from "../../../../shared/services/response";
import {
  captureAndStoreScreenshot,
  isLocalProjectScreenshotUrl,
  readLocalProjectScreenshot,
} from "../../../../shared/services/screenshot-service";
import { extractKeyFromUrl, getS3Client, isS3Configured } from "../../../../shared/services/s3-service";
import { env, logger } from "@almirant/config";
import { getPermissionChecker } from "@almirant/shared";

const NIGHTLY_VALIDATION_UNAVAILABLE_MESSAGE =
  "Nightly validation is unavailable until the projects.nightly_validation migration is applied.";
const NIGHTLY_VALIDATION_PROVIDER_SCHEMA = t.Union([
  t.Literal("claude-code"),
  t.Literal("codex"),
  t.Literal("zipu"),
  t.Literal("grok"),
]);
const DEFAULT_NIGHTLY_VALIDATION_PROVIDER = "claude-code" as const;
const PROJECT_CODING_AGENT_SCHEMA = t.Union([t.Literal("claude-code"), t.Literal("codex"), t.Literal("opencode")]);
const PROJECT_AI_PROVIDER_SCHEMA = t.Union([t.Literal("anthropic"), t.Literal("openai"), t.Literal("google"), t.Literal("zai"), t.Literal("xai")]);
const PROJECT_AGENT_DEFAULTS_SCHEMA = t.Object(
  {
    implementation: t.Optional(t.Nullable(t.Object({
      codingAgent: t.Optional(t.Nullable(PROJECT_CODING_AGENT_SCHEMA)),
      aiProvider: t.Optional(t.Nullable(PROJECT_AI_PROVIDER_SCHEMA)),
      model: t.Optional(t.Nullable(t.String())),
      reasoningLevel: t.Optional(t.Nullable(t.String())),
    }))),
  },
  { additionalProperties: false },
);

const getErrorMessage = (error: unknown): string => {
  if (!error) {
    return "";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "";
};

const isMissingProjectNightlyValidationColumnError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? error.code : undefined;
  const message = getErrorMessage(error);
  const causeMessage = "cause" in error ? getErrorMessage(error.cause) : "";
  const combinedMessage = `${message} ${causeMessage}`;

  return (
    combinedMessage.includes("nightly_validation") &&
    (code === "42703" ||
      combinedMessage.includes("does not exist") ||
      combinedMessage.includes("column"))
  );
};

export const projectsRoutes = new Elysia({ prefix: "/projects" })
  .use(sessionContextTypes)

  // ──────────────────────────────────────────────
  // Projects CRUD
  // ──────────────────────────────────────────────

  // GET /projects — List with pagination and filters
  .get("/", async ({ query, activeOrganization, user }) => {
    const orgId = activeOrganization!.id;
    const pagination = parsePaginationParams(query);

    const filters = {
      search: query.search || undefined,
      status: (query.status || undefined) as "active" | "archived" | "on_hold" | undefined,
      organizationId: query.organizationId || undefined,
      organizationIds: query.organizationIds ? query.organizationIds.split(",") : undefined,
      personal: query.personal === "true",
      includeArchived: query.includeArchived === "true",
      userId: user?.id,
    };

    const { projects, total } = await getProjects(orgId, pagination, filters);
    const meta = buildPaginationMeta(pagination.page, pagination.limit, total);

    return successResponse(projects, meta);
  }, {
    query: t.Object({
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      search: t.Optional(t.String()),
      status: t.Optional(t.String()),
      organizationId: t.Optional(t.String()),
      organizationIds: t.Optional(t.String()),
      personal: t.Optional(t.String()),
      includeArchived: t.Optional(t.String()),
    }),
  })

  // POST /projects — Create project
  .post("/", async ({ body, set, activeOrganization, user }) => {
    const orgId = activeOrganization!.id;

    if (!body.name || body.name.trim() === "") {
      set.status = 400;
      return errorResponse("Name is required");
    }

    const project = await createProject(orgId, {
      ...body,
      status: body.status as "active" | "archived" | "on_hold" | undefined,
    });

    // Auto-add creator as project owner
    await addProjectMember(project.id, user!.id, "owner");

    if (project.productionUrl) {
      captureAndStoreScreenshot(project.id, project.productionUrl).catch((e) =>
        logger.error(e, "Auto screenshot capture failed on project creation")
      );
    }

    set.status = 201;
    return successResponse(project);
  }, {
    body: t.Object({
      name: t.String(),
      description: t.Optional(t.String()),
      folderPath: t.Optional(t.String()),
      color: t.Optional(t.String()),
      icon: t.Optional(t.String()),
      status: t.Optional(t.String()),
      clientName: t.Optional(t.String()),
      productionUrl: t.Optional(t.String()),
      stagingUrl: t.Optional(t.String()),
      techStack: t.Optional(t.Array(t.String())),
      organizationId: t.Optional(t.Nullable(t.String())),
      startDate: t.Optional(t.String()),
      targetDate: t.Optional(t.String()),
    }),
  })

  // GET /projects/linked-github-urls — All GitHub repo URLs linked to any project
  .get("/linked-github-urls", async ({ activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const urls = await getAllGithubRepoUrls(orgId);
    return successResponse(urls);
  })

  // GET /projects/:id — Get by ID
  .get("/:id", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);

    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    return successResponse(project);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // PATCH /projects/:id — Update project
  .patch("/:id", async ({ params, body, set, activeOrganization, user }) => {
    const orgId = activeOrganization!.id;

    // Pre-fetch the existing project when we need to compare fields
    const needsExistingProject =
      body.productionUrl !== undefined ||
      (body.organizationId !== undefined && body.organizationId !== null);

    let oldProductionUrl: string | null = null;
    let existing: Awaited<ReturnType<typeof getProjectById>> | null = null;

    if (needsExistingProject) {
      existing = await getProjectById(orgId, params.id);
      if (existing) {
        oldProductionUrl = existing.productionUrl;
      }
    }

    // Validate permissions when transferring project to a different workspace
    const targetOrgId = body.organizationId;
    if (
      targetOrgId !== undefined &&
      targetOrgId !== null &&
      existing &&
      targetOrgId !== (existing.organizationId ?? "")
    ) {
      const membership = await db
        .select({ role: schema.member.role })
        .from(schema.member)
        .where(
          and(
            eq(schema.member.userId, user!.id),
            eq(schema.member.organizationId, targetOrgId)
          )
        )
        .limit(1);

      if (
        membership.length === 0 ||
        !getPermissionChecker().can(
          { userId: user!.id, organizationId: targetOrgId, role: membership[0]!.role },
          "project.transfer"
        )
      ) {
        set.status = 403;
        return errorResponse(
          "No tienes permisos de admin u owner en el workspace destino"
        );
      }
    }

    // Detect transfer: organizationId is changing to a different org
    const isTransfer =
      targetOrgId !== undefined &&
      targetOrgId !== null &&
      existing &&
      targetOrgId !== (existing.organizationId ?? "");

    if (isTransfer) {
      // Transfer project + child entities (ideaItems, milestones) atomically
      await transferProject(orgId, params.id, targetOrgId!);
    }

    // Apply remaining field updates (including organizationId for the project row itself if not transferred separately)
    const { organizationId: _orgId, ...updateFields } = body;
    const hasOtherUpdates = Object.values(updateFields).some((v) => v !== undefined);

    // Use the effective org for the update query
    const effectiveOrgId = isTransfer ? targetOrgId! : orgId;

    let project;
    if (hasOtherUpdates) {
      project = await updateProject(effectiveOrgId, params.id, {
        ...updateFields,
        status: updateFields.status as "active" | "archived" | "on_hold" | undefined,
      });
    } else if (isTransfer) {
      // Only a transfer, no other fields — just fetch the updated project
      project = await getProjectById(effectiveOrgId, params.id);
    } else {
      // No transfer and no other updates — still call updateProject for consistency (touch updatedAt)
      project = await updateProject(orgId, params.id, {
        ...body,
        status: body.status as "active" | "archived" | "on_hold" | undefined,
      });
    }

    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    // Auto-capture screenshot when productionUrl changes
    if (
      body.productionUrl &&
      body.productionUrl !== oldProductionUrl
    ) {
      captureAndStoreScreenshot(params.id, body.productionUrl).catch((e) =>
        logger.error(e, "Auto screenshot capture failed on productionUrl change")
      );
    }

    return successResponse(project);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      name: t.Optional(t.String()),
      description: t.Optional(t.Nullable(t.String())),
      folderPath: t.Optional(t.Nullable(t.String())),
      color: t.Optional(t.String()),
      icon: t.Optional(t.Nullable(t.String())),
      status: t.Optional(t.String()),
      clientName: t.Optional(t.Nullable(t.String())),
      productionUrl: t.Optional(t.Nullable(t.String())),
      stagingUrl: t.Optional(t.Nullable(t.String())),
      screenshotUrl: t.Optional(t.Nullable(t.String())),
      techStack: t.Optional(t.Nullable(t.Array(t.String()))),
      organizationId: t.Optional(t.Nullable(t.String())),
      startDate: t.Optional(t.Nullable(t.String())),
      targetDate: t.Optional(t.Nullable(t.String())),
    }),
  })

  // POST /projects/:id/archive — Archive project (logical delete)
  .post("/:id/archive", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const archived = await archiveProject(orgId, params.id);

    if (!archived) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    return successResponse(archived);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // DELETE /projects/:id — Delete project
  .delete("/:id", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const deleted = await deleteProject(orgId, params.id);

    if (!deleted) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    return successResponse({ deleted: true });
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // POST /projects/:id/capture-screenshot — Trigger manual screenshot capture
  .post("/:id/capture-screenshot", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);

    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    if (!project.productionUrl) {
      set.status = 400;
      return errorResponse("Project has no production URL configured");
    }

    // Fire-and-forget
    captureAndStoreScreenshot(params.id, project.productionUrl).catch((e) =>
      logger.error(e, "Manual screenshot capture failed")
    );

    return successResponse({ message: "Screenshot capture started" });
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // GET /projects/:id/screenshot — Serve private screenshot from S3
  .get("/:id/screenshot", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);

    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    if (!project.screenshotUrl) {
      set.status = 404;
      return errorResponse("Project has no screenshot configured");
    }

    if (isLocalProjectScreenshotUrl(project.screenshotUrl)) {
      const bodyBytes = await readLocalProjectScreenshot(project.screenshotUrl);

      if (!bodyBytes) {
        set.status = 404;
        return errorResponse("Screenshot not found");
      }

      return new Response(bodyBytes, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, max-age=86400",
        },
      });
    }

    if (!isS3Configured()) {
      set.status = 503;
      return errorResponse("S3 storage is not configured");
    }

    const key = extractKeyFromUrl(project.screenshotUrl);
    if (!key) {
      set.status = 400;
      return errorResponse("Invalid screenshot URL");
    }

    try {
      const client = getS3Client();
      const response = await client.send(
        new GetObjectCommand({
          Bucket: env.S3_BUCKET!,
          Key: key,
        })
      );

      if (!response.Body) {
        set.status = 404;
        return errorResponse("Screenshot not found");
      }

      const bodyBytes = await response.Body.transformToByteArray();
      const contentType = response.ContentType || "image/png";
      const cacheControl = response.CacheControl || "private, max-age=300";

      set.headers["content-type"] = contentType;
      set.headers["cache-control"] = cacheControl;

      return new Response(bodyBytes, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": cacheControl,
        },
      });
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };

      if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
        set.status = 404;
        return errorResponse("Screenshot not found");
      }

      logger.error({ err, projectId: params.id, key }, "Failed to fetch project screenshot from S3");
      set.status = 500;
      return errorResponse("Failed to fetch screenshot");
    }
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // ──────────────────────────────────────────────
  // Roadmap
  // ──────────────────────────────────────────────

  // GET /projects/:id/roadmap — Hierarchical roadmap with calculated dates
  .get("/:id/roadmap", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);

    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const roadmap = await getProjectRoadmap(params.id);

    return successResponse(roadmap);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // ──────────────────────────────────────────────
  // Stats
  // ──────────────────────────────────────────────

  // GET /projects/:id/stats/by-type — Work item stats grouped by type
  .get("/:id/stats/by-type", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);

    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const stats = await getWorkItemStatsByType(params.id);

    return successResponse(stats);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })


  // ──────────────────────────────────────────────
  // Project Detail (batch endpoint)
  // ──────────────────────────────────────────────

  // GET /projects/:id/detail — Batch: project + boards + docLinks + repositories + notes
  .get("/:id/detail", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);

    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const [boards, docLinks, repositories, notes] = await Promise.all([
      getAllBoards(orgId).catch((e) => {
        logger.error(e, "Failed to fetch boards for project detail batch");
        return [];
      }),
      getDocLinks(orgId, params.id).catch((e) => {
        logger.error(e, "Failed to fetch doc links for project detail batch");
        return [];
      }),
      getRepositories(orgId, params.id).catch((e) => {
        logger.error(e, "Failed to fetch repositories for project detail batch");
        return [];
      }),
      getNotes(orgId, params.id).catch((e) => {
        logger.error(e, "Failed to fetch notes for project detail batch");
        return [];
      }),
    ]);

    return successResponse({ project, boards, docLinks, repositories, notes });
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // ──────────────────────────────────────────────
  // Project Members sub-resource
  // ──────────────────────────────────────────────

  // GET /projects/:id/members — List project members
  .get("/:id/members", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);

    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const members = await getProjectMembers(params.id);
    return successResponse(members);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // POST /projects/:id/members — Add a member to the project
  .post("/:id/members", async ({ params, body, set, activeOrganization, user }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);

    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    // Validate caller is owner or admin of this project
    const currentMembers = await getProjectMembers(params.id);
    const callerMembership = currentMembers.find((m) => m.userId === user!.id);

    if (
      !callerMembership ||
      !getPermissionChecker().can(
        { userId: user!.id, organizationId: orgId, role: callerMembership.role },
        "project.member.add"
      )
    ) {
      set.status = 403;
      return errorResponse("Only project owners or admins can add members");
    }

    // Validate invited user belongs to the same organization
    const orgMembership = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, orgId),
          eq(schema.member.userId, body.userId)
        )
      )
      .limit(1);

    if (orgMembership.length === 0) {
      set.status = 400;
      return errorResponse("User does not belong to this organization");
    }

    const member = await addProjectMember(params.id, body.userId, body.role || "member");
    set.status = 201;
    return successResponse(member);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      userId: t.String(),
      role: t.Optional(t.String()),
    }),
  })

  // DELETE /projects/:id/members/:userId — Remove a member from the project
  .delete("/:id/members/:userId", async ({ params, set, activeOrganization, user }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);

    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    // Validate caller is owner or admin of this project
    const currentMembers = await getProjectMembers(params.id);
    const callerMembership = currentMembers.find((m) => m.userId === user!.id);

    if (
      !callerMembership ||
      !getPermissionChecker().can(
        { userId: user!.id, organizationId: orgId, role: callerMembership.role },
        "project.member.remove"
      )
    ) {
      set.status = 403;
      return errorResponse("Only project owners or admins can remove members");
    }

    // Prevent owner from removing themselves
    const targetMembership = currentMembers.find((m) => m.userId === params.userId);
    if (targetMembership && targetMembership.role === "owner" && params.userId === user!.id) {
      set.status = 400;
      return errorResponse("Project owner cannot remove themselves");
    }

    const removed = await removeProjectMember(params.id, params.userId);
    if (!removed) {
      set.status = 404;
      return errorResponse("Member not found in project");
    }

    return successResponse({ removed: true });
  }, {
    params: t.Object({
      id: t.String(),
      userId: t.String(),
    }),
  })

  // ──────────────────────────────────────────────
  // Doc Links sub-resource
  // ──────────────────────────────────────────────

  // GET /projects/:id/doc-links — List doc links
  .get("/:id/doc-links", async ({ params, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const links = await getDocLinks(orgId, params.id);

    return successResponse(links);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // POST /projects/:id/doc-links — Create doc link
  .post("/:id/doc-links", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    if (!body.title || body.title.trim() === "") {
      set.status = 400;
      return errorResponse("Title is required");
    }

    if (!body.url || body.url.trim() === "") {
      set.status = 400;
      return errorResponse("URL is required");
    }

    const link = await createDocLink(orgId, params.id, {
      ...body,
      type: body.type as "notion" | "github" | "gdocs" | "confluence" | "figma" | "other" | undefined,
    });

    set.status = 201;
    return successResponse(link);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      title: t.String(),
      url: t.String(),
      type: t.Optional(t.String()),
      order: t.Optional(t.Number()),
    }),
  })

  // PATCH /projects/:id/doc-links/reorder — Reorder doc links
  // NOTE: This route MUST be registered before /:id/doc-links/:linkId
  // to avoid "reorder" being captured as a :linkId param.
  .patch("/:id/doc-links/reorder", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    if (!body.linkIds || !Array.isArray(body.linkIds) || body.linkIds.length === 0) {
      set.status = 400;
      return errorResponse("linkIds array is required");
    }

    await reorderDocLinks(orgId, params.id, body.linkIds);
    const links = await getDocLinks(orgId, params.id);

    return successResponse(links);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      linkIds: t.Array(t.String()),
    }),
  })

  // PATCH /projects/:id/doc-links/:linkId — Update doc link
  .patch("/:id/doc-links/:linkId", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const link = await updateDocLink(orgId, params.linkId, {
      ...body,
      type: body.type as "notion" | "github" | "gdocs" | "confluence" | "figma" | "other" | undefined,
    });

    if (!link) {
      set.status = 404;
      return notFoundResponse("Doc link");
    }

    return successResponse(link);
  }, {
    params: t.Object({
      id: t.String(),
      linkId: t.String(),
    }),
    body: t.Object({
      title: t.Optional(t.String()),
      url: t.Optional(t.String()),
      type: t.Optional(t.String()),
      order: t.Optional(t.Number()),
    }),
  })

  // DELETE /projects/:id/doc-links/:linkId — Delete doc link
  .delete("/:id/doc-links/:linkId", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const deleted = await deleteDocLink(orgId, params.linkId);

    if (!deleted) {
      set.status = 404;
      return notFoundResponse("Doc link");
    }

    return successResponse({ deleted: true });
  }, {
    params: t.Object({
      id: t.String(),
      linkId: t.String(),
    }),
  })

  // ──────────────────────────────────────────────
  // Repositories sub-resource
  // ──────────────────────────────────────────────

  // GET /projects/:id/repositories — List repositories
  .get("/:id/repositories", async ({ params, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const repos = await getRepositories(orgId, params.id);

    return successResponse(repos);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // POST /projects/:id/repositories — Create repository
  .post("/:id/repositories", async ({ params, body, set, activeOrganization }) => {
    if (!body.name || body.name.trim() === "") {
      set.status = 400;
      return errorResponse("Name is required");
    }

    if (!body.url || body.url.trim() === "") {
      set.status = 400;
      return errorResponse("URL is required");
    }

    const orgId = activeOrganization!.id;
    const repo = await createRepository(orgId, params.id, {
      ...body,
      provider: body.provider as "github" | "gitlab" | "bitbucket" | "other" | undefined,
    });

    if (!repo) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    // Auto-link to GitHub installation if this is a GitHub repo
    const effectiveProvider = body.provider || "github";
    if (effectiveProvider === "github" && activeOrganization) {
      const githubRepoFullName = extractGithubRepoFullName(body.url);
      if (githubRepoFullName) {
        try {
          const connection = await getGithubConnectionForOrganization(activeOrganization.id);
          if (connection) {
            await linkRepoToInstallation({
              installationId: connection.id,
              repoId: repo.id,
              githubRepoFullName,
            });
            logger.info(
              { repoId: repo.id, connectionId: connection.id, githubRepoFullName },
              "Auto-linked repository to GitHub installation"
            );
          }
        } catch (err) {
          // Do not fail the repo creation if linking fails
          logger.error(err, "Failed to auto-link repository to GitHub installation");
        }
      }
    }

    set.status = 201;
    return successResponse(repo);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      name: t.String(),
      url: t.String(),
      provider: t.Optional(t.String()),
      isMonorepo: t.Optional(t.Boolean()),
      order: t.Optional(t.Number()),
    }),
  })

  // PATCH /projects/:id/repositories/reorder — Reorder repositories
  // NOTE: This route MUST be registered before /:id/repositories/:repoId
  // to avoid "reorder" being captured as a :repoId param.
  .patch("/:id/repositories/reorder", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    if (!body.repoIds || !Array.isArray(body.repoIds) || body.repoIds.length === 0) {
      set.status = 400;
      return errorResponse("repoIds array is required");
    }

    await reorderRepositories(orgId, params.id, body.repoIds);
    const repos = await getRepositories(orgId, params.id);

    return successResponse(repos);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      repoIds: t.Array(t.String()),
    }),
  })

  // POST /projects/:id/repositories/repair-links — Repair missing GitHub installation links
  // NOTE: This route MUST be registered before /:id/repositories/:repoId
  // to avoid "repair-links" being captured as a :repoId param.
  .post("/:id/repositories/repair-links", async ({ params, set, activeOrganization }) => {
    if (!activeOrganization) {
      set.status = 400;
      return errorResponse("Active organization is required");
    }

    const connection = await getGithubConnectionForOrganization(activeOrganization.id);
    if (!connection) {
      return successResponse({ repaired: 0, message: "No active GitHub installation found for this organization" });
    }

    const unlinkedRepos = await getUnlinkedGithubRepos(params.id);
    if (unlinkedRepos.length === 0) {
      return successResponse({ repaired: 0, message: "All GitHub repositories already have installation links" });
    }

    const results: Array<{ repoId: string; name: string; linked: boolean; error?: string }> = [];

    for (const repo of unlinkedRepos) {
      const githubRepoFullName = extractGithubRepoFullName(repo.url);
      if (!githubRepoFullName) {
        results.push({ repoId: repo.id, name: repo.name, linked: false, error: "Could not extract GitHub full name from URL" });
        continue;
      }

      try {
        await linkRepoToInstallation({
          installationId: connection.id,
          repoId: repo.id,
          githubRepoFullName,
        });
        results.push({ repoId: repo.id, name: repo.name, linked: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ repoId: repo.id, name: repo.name, linked: false, error: message });
        logger.error(err, `Failed to repair link for repo ${repo.id}`);
      }
    }

    const repaired = results.filter((r) => r.linked).length;
    return successResponse({ repaired, total: unlinkedRepos.length, results });
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // PATCH /projects/:id/repositories/:repoId — Update repository
  .patch("/:id/repositories/:repoId", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const repo = await updateRepository(orgId, params.repoId, {
      ...body,
      provider: body.provider as "github" | "gitlab" | "bitbucket" | "other" | undefined,
    });

    if (!repo) {
      set.status = 404;
      return notFoundResponse("Repository");
    }

    return successResponse(repo);
  }, {
    params: t.Object({
      id: t.String(),
      repoId: t.String(),
    }),
    body: t.Object({
      name: t.Optional(t.String()),
      url: t.Optional(t.String()),
      provider: t.Optional(t.String()),
      isMonorepo: t.Optional(t.Boolean()),
      order: t.Optional(t.Number()),
    }),
  })

  // DELETE /projects/:id/repositories/:repoId — Delete repository
  .delete("/:id/repositories/:repoId", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const deleted = await deleteRepository(orgId, params.repoId);

    if (!deleted) {
      set.status = 404;
      return notFoundResponse("Repository");
    }

    return successResponse({ deleted: true });
  }, {
    params: t.Object({
      id: t.String(),
      repoId: t.String(),
    }),
  })

  // ──────────────────────────────────────────────
  // Notes sub-resource
  // ──────────────────────────────────────────────

  // GET /projects/:id/notes — List notes
  .get("/:id/notes", async ({ params, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const notes = await getNotes(orgId, params.id);

    return successResponse(notes);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // POST /projects/:id/notes — Create note
  .post("/:id/notes", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    if (!body.title || body.title.trim() === "") {
      set.status = 400;
      return errorResponse("Title is required");
    }

    const note = await createNote(orgId, params.id, body);

    set.status = 201;
    return successResponse(note);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      title: t.String(),
      content: t.Optional(t.String()),
      order: t.Optional(t.Number()),
    }),
  })

  // PATCH /projects/:id/notes/reorder — Reorder notes
  // NOTE: This route MUST be registered before /:id/notes/:noteId
  // to avoid "reorder" being captured as a :noteId param.
  .patch("/:id/notes/reorder", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    if (!body.noteIds || !Array.isArray(body.noteIds) || body.noteIds.length === 0) {
      set.status = 400;
      return errorResponse("noteIds array is required");
    }

    await reorderNotes(orgId, params.id, body.noteIds);
    const notes = await getNotes(orgId, params.id);

    return successResponse(notes);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      noteIds: t.Array(t.String()),
    }),
  })

  // GET /projects/:id/notes/:noteId — Get note by ID
  .get("/:id/notes/:noteId", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const note = await getNoteById(orgId, params.noteId);

    if (!note) {
      set.status = 404;
      return notFoundResponse("Note");
    }

    return successResponse(note);
  }, {
    params: t.Object({
      id: t.String(),
      noteId: t.String(),
    }),
  })

  // PATCH /projects/:id/notes/:noteId — Update note
  .patch("/:id/notes/:noteId", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const note = await updateNote(orgId, params.noteId, body);

    if (!note) {
      set.status = 404;
      return notFoundResponse("Note");
    }

    return successResponse(note);
  }, {
    params: t.Object({
      id: t.String(),
      noteId: t.String(),
    }),
    body: t.Object({
      title: t.Optional(t.String()),
      content: t.Optional(t.Nullable(t.String())),
      order: t.Optional(t.Number()),
    }),
  })

  // DELETE /projects/:id/notes/:noteId — Delete note
  .delete("/:id/notes/:noteId", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const deleted = await deleteNote(orgId, params.noteId);

    if (!deleted) {
      set.status = 404;
      return notFoundResponse("Note");
    }

    return successResponse({ deleted: true });
  }, {
    params: t.Object({
      id: t.String(),
      noteId: t.String(),
    }),
  })

  // ──────────────────────────────────────────────
  // Boards sub-resource
  // ──────────────────────────────────────────────

  // GET /projects/:id/boards — List boards for the project's organization
  .get("/:id/boards", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);

    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const boardsList = await getAllBoards(orgId);

    return successResponse(boardsList);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // GET /projects/:id/nightly-validation — Get nightly validation config
  .get("/:id/nightly-validation", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }
    let config;
    try {
      config = await getProjectNightlyValidation(params.id);
    } catch (error) {
      if (isMissingProjectNightlyValidationColumnError(error)) {
        logger.warn({ error, projectId: params.id }, "Project nightly validation column missing");
        set.status = 503;
        return errorResponse(NIGHTLY_VALIDATION_UNAVAILABLE_MESSAGE, 503);
      } else {
        throw error;
      }
    }
    return successResponse(config);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // PATCH /projects/:id/nightly-validation — Update nightly validation config
  .patch("/:id/nightly-validation", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }
    if (body.startHour < 0 || body.startHour > 23 || body.endHour < 0 || body.endHour > 23) {
      set.status = 400;
      return errorResponse("Hours must be between 0 and 23", 400);
    }
    try {
      await updateProjectNightlyValidation(params.id, {
        enabled: body.enabled,
        startHour: body.startHour,
        endHour: body.endHour,
        timezone: body.timezone,
        provider: body.provider ?? DEFAULT_NIGHTLY_VALIDATION_PROVIDER,
      });
    } catch (error) {
      if (isMissingProjectNightlyValidationColumnError(error)) {
        set.status = 503;
        return errorResponse(NIGHTLY_VALIDATION_UNAVAILABLE_MESSAGE, 503);
      }

      throw error;
    }
    const updated = await getProjectNightlyValidation(params.id);
    return successResponse(updated);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      enabled: t.Boolean(),
      startHour: t.Number(),
      endHour: t.Number(),
      timezone: t.String(),
      provider: t.Optional(NIGHTLY_VALIDATION_PROVIDER_SCHEMA),
    }),
  })

  // ──────────────────────────────────────────────
  // AI Config sub-resource
  // ──────────────────────────────────────────────

  // GET /projects/:id/ai-config
  .get("/:id/ai-config", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }
    const config = await getProjectAiConfig(params.id);
    return successResponse(config);
  }, {
    params: t.Object({ id: t.String() }),
  })

  // PATCH /projects/:id/ai-config
  .patch("/:id/ai-config", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }
    if (body.defaultProvider !== null && !["claude-code", "codex", "zipu", "grok"].includes(body.defaultProvider)) {
      set.status = 400;
      return errorResponse("Invalid provider. Must be one of: claude-code, codex, zipu, grok", 400);
    }
    const updated = await updateProjectAiConfig(params.id, body.defaultProvider, body.agentDefaults);
    return successResponse(updated);
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      defaultProvider: t.Nullable(t.String()),
      agentDefaults: t.Optional(PROJECT_AGENT_DEFAULTS_SCHEMA),
    }),
  })

  // ──────────────────────────────────────────────
  // Skill Config sub-resource
  // ──────────────────────────────────────────────

  // GET /projects/:id/skill-config — Get skill config
  .get("/:id/skill-config", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }
    const config = await getSkillConfig(params.id);
    return successResponse(config);
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // PATCH /projects/:id/skill-config — Update skill config
  .patch("/:id/skill-config", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }
    const updated = await updateSkillConfig(params.id, {
      skillSet: body.skillSet,
      customSkillsUrl: body.customSkillsUrl ?? null,
      disabledSkills: body.disabledSkills ?? [],
      agentInstructions: body.agentInstructions ?? "",
    });
    return successResponse(updated);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      skillSet: t.Union([t.Literal("platform"), t.Literal("custom")]),
      customSkillsUrl: t.Optional(t.Nullable(t.String())),
      disabledSkills: t.Optional(t.Array(t.String())),
      agentInstructions: t.Optional(t.String()),
    }),
  })

  // Discord Channel sub-resource

  // GET /projects/:id/discord-channel — Get the Discord channel override for a project
  .get("/:id/discord-channel", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const connection = await getDiscordConnectionByOrganization(orgId);
    if (!connection) {
      return successResponse({
        projectChannel: null,
        connection: null,
      });
    }

    const projectChannel = await getDiscordProjectChannel(connection.id, params.id);

    return successResponse({
      projectChannel: projectChannel
        ? { channelId: projectChannel.channelId, channelName: projectChannel.channelName }
        : null,
      connection: {
        defaultChannelId: connection.defaultChannelId,
        defaultChannelName: connection.defaultChannelName,
        guildName: connection.guildName,
      },
    });
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // PATCH /projects/:id/discord-channel — Set/update the Discord channel override
  .patch("/:id/discord-channel", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const connection = await getDiscordConnectionByOrganization(orgId);
    if (!connection) {
      set.status = 400;
      return errorResponse("No Discord connection found for this organization", 400);
    }

    const upserted = await upsertDiscordProjectChannel({
      discordConnectionId: connection.id,
      projectId: params.id,
      channelId: body.channelId,
      channelName: body.channelName,
    });

    return successResponse({
      channelId: upserted.channelId,
      channelName: upserted.channelName,
    });
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      channelId: t.String(),
      channelName: t.String(),
    }),
  })

  // ──────────────────────────────────────────────
  // Discord Notification Preferences sub-resource
  // ──────────────────────────────────────────────

  // GET /projects/:id/discord-notifications — Get project-level notification prefs
  .get("/:id/discord-notifications", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const connection = await getDiscordConnectionByOrganization(orgId);
    if (!connection) {
      return successResponse({ preferences: null, orgDefaults: null });
    }

    const DEFAULT_NOTIFICATION_PREFS = {
      enabled: true,
      notifyWorkItemCreated: true,
      notifyWorkItemMoved: true,
      notifyWorkItemAssigned: true,
      notifyWorkItemDone: true,
      notifyWorkItemComment: true,
      notifyWorkItemUpdated: false,
      notifyWorkItemDeleted: false,
      notifyCommentAdded: false,
      notifyAttachmentAdded: false,
      notifySprintStarted: true,
      notifySprintClosed: true,
      notifyMilestoneCompleted: true,
      notifyPrOpened: true,
      notifyPrMerged: true,
      notifyCiFailed: true,
      notifyAgentJobCompleted: true,
      notifyAgentJobFailed: true,
      notifySeedPromoted: true,
    };

    const [projectPrefs, orgPrefs] = await Promise.all([
      getDiscordNotificationPreferences(connection.id, params.id),
      getDiscordNotificationPreferences(connection.id, null),
    ]);

    return successResponse({
      preferences: projectPrefs,
      orgDefaults: orgPrefs ?? DEFAULT_NOTIFICATION_PREFS,
    });
  }, {
    params: t.Object({
      id: t.String(),
    }),
  })

  // PATCH /projects/:id/discord-notifications — Upsert project-level notification prefs
  .patch("/:id/discord-notifications", async ({ params, body, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const connection = await getDiscordConnectionByOrganization(orgId);
    if (!connection) {
      set.status = 400;
      return errorResponse("No Discord connection found for this organization", 400);
    }

    const upserted = await upsertDiscordNotificationPreferences({
      discordConnectionId: connection.id,
      projectId: params.id,
      ...body,
    });

    return successResponse(upserted);
  }, {
    params: t.Object({
      id: t.String(),
    }),
    body: t.Object({
      enabled: t.Optional(t.Boolean()),
      notifyWorkItemCreated: t.Optional(t.Boolean()),
      notifyWorkItemMoved: t.Optional(t.Boolean()),
      notifyWorkItemAssigned: t.Optional(t.Boolean()),
      notifyWorkItemDone: t.Optional(t.Boolean()),
      notifyWorkItemComment: t.Optional(t.Boolean()),
      notifyWorkItemUpdated: t.Optional(t.Boolean()),
      notifyWorkItemDeleted: t.Optional(t.Boolean()),
      notifyCommentAdded: t.Optional(t.Boolean()),
      notifyAttachmentAdded: t.Optional(t.Boolean()),
      notifySprintStarted: t.Optional(t.Boolean()),
      notifySprintClosed: t.Optional(t.Boolean()),
      notifyMilestoneCompleted: t.Optional(t.Boolean()),
      notifyPrOpened: t.Optional(t.Boolean()),
      notifyPrMerged: t.Optional(t.Boolean()),
      notifyCiFailed: t.Optional(t.Boolean()),
      notifyAgentJobCompleted: t.Optional(t.Boolean()),
      notifyAgentJobFailed: t.Optional(t.Boolean()),
      notifySeedPromoted: t.Optional(t.Boolean()),
    }),
  })

  // DELETE /projects/:id/discord-notifications — Delete project-level notification override
  .delete("/:id/discord-notifications", async ({ params, set, activeOrganization }) => {
    const orgId = activeOrganization!.id;
    const project = await getProjectById(orgId, params.id);
    if (!project) {
      set.status = 404;
      return notFoundResponse("Project");
    }

    const connection = await getDiscordConnectionByOrganization(orgId);
    if (!connection) {
      set.status = 400;
      return errorResponse("No Discord connection found for this organization", 400);
    }

    const deleted = await deleteDiscordProjectNotificationPreferences(
      connection.id,
      params.id,
    );

    return successResponse({ deleted });
  }, {
    params: t.Object({
      id: t.String(),
    }),
  });
