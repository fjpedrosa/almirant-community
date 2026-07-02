import { Elysia, t } from "elysia";
import {
  createApiKey,
  getProjectById,
  listApiKeys,
  resolveProjectWorkspace,
  revokeApiKey,
} from "@almirant/database";
import { sessionContextTypes } from "../../../shared/middleware/session-context-types.plugin";
import {
  errorResponse,
  notFoundResponse,
  successResponse,
} from "../../../shared/services/response";
import { getInstanceConfig } from "../../instance/services/instance-config-service";
import {
  completeAgentConnectionLinkTokenClaim,
  consumeAgentConnectionLinkToken,
  createAgentConnectionLinkToken,
  releaseAgentConnectionLinkTokenClaim,
} from "../services/agent-connection-link-token-store";

const EXTERNAL_AGENT_KEY_PREFIX = "External agent:";
const DEFAULT_AGENT_NAME = "External agent";
const MCP_PERMISSIONS = ["mcp:read", "mcp:write"];

const normalizeBaseUrl = (raw: string): string => raw.replace(/\/+$/, "");

const getRequestOrigin = (request: Request): string => {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
};

const resolveBaseUrl = async (request: Request): Promise<string> => {
  const config = await getInstanceConfig();
  return normalizeBaseUrl(config.publicUrl ?? getRequestOrigin(request));
};

const sanitizeAgentName = (value: string | undefined): string => {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_AGENT_NAME;
  return trimmed.slice(0, 80);
};

const buildScopeDescription = (projectName: string | null): string =>
  projectName
    ? `Esta conexión está pensada para trabajar en el proyecto "${projectName}".`
    : "Esta conexión está pensada para trabajar con todos los proyectos disponibles en el workspace.";

const buildPostConnectionInstruction = (projectName: string | null): string =>
  projectName
    ? `Cuando el MCP esté configurado, verifica la conexión llamando a la herramienta MCP \`list_projects\`. Debe devolverte únicamente el proyecto "${projectName}". Usa ese proyecto como contexto por defecto salvo que el usuario indique otra cosa.`
    : "Cuando el MCP esté configurado, verifica la conexión llamando a la herramienta MCP `list_projects`. Después explora la lista de proyectos disponibles y pregunta cuál usar si la tarea no lo deja claro.";

const buildClaimPrompt = (claimUrl: string, projectName: string | null): string => `Conéctate a mi instancia Almirant self-hosted.

${buildScopeDescription(projectName)}

Haz una llamada GET a este endpoint de emparejamiento temporal:

${claimUrl}

IMPORTANTE:
- Haz UNA SOLA llamada GET al endpoint. No hagas probing, no lo abras en navegador y no repitas la llamada para "ver el cuerpo".
- El enlace es de un solo uso y expira en 10 minutos. Si recibes 409, significa que el enlace ya fue reclamado; pide al usuario que genere uno nuevo.
- Sigue exactamente las instrucciones JSON que devuelva la API.
- No muestres, pegues ni registres secretos como el header Authorization.
- ${buildPostConnectionInstruction(projectName)}`;

const buildMcpUrl = (baseUrl: string, projectId: string | null): string =>
  projectId
    ? `${baseUrl}/mcp?projectId=${encodeURIComponent(projectId)}`
    : `${baseUrl}/mcp`;

const buildMcpConfig = (baseUrl: string, projectId: string | null, apiKey: string) => ({
  mcpServers: {
    almirant: {
      type: "http",
      url: buildMcpUrl(baseUrl, projectId),
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    },
  },
});

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
};

const stripExternalAgentPrefix = (name: string): string =>
  name.startsWith(EXTERNAL_AGENT_KEY_PREFIX)
    ? name.slice(EXTERNAL_AGENT_KEY_PREFIX.length).trim()
    : name;

const protectedRoutes = () =>
  new Elysia({ prefix: "/agent-connections" })
    .use(sessionContextTypes)
    .post(
      "/link-token",
      async ({ body, request, set, user, activeWorkspace }) => {
        try {
          const orgId = activeWorkspace!.id;
          const userId = (user as { id: string }).id;
          const projectId = body.projectId?.trim() || null;
          let projectName: string | null = null;

          if (projectId) {
            const projectOrgId = await resolveProjectWorkspace(projectId, userId);

            if (projectOrgId !== orgId) {
              set.status = 404;
              return notFoundResponse("Project");
            }

            const project = await getProjectById(orgId, projectId);
            projectName = project?.name ?? projectId;
          }

          const baseUrl = await resolveBaseUrl(request);
          const agentName = sanitizeAgentName(body.agentName);
          const entry = createAgentConnectionLinkToken({
            userId,
            workspaceId: orgId,
            projectId,
            projectName,
            agentName,
            baseUrl,
          });
          const claimUrl = `${baseUrl}/api/agent-connections/claim/${entry.token}`;

          set.status = 201;
          return successResponse({
            token: entry.token,
            claimUrl,
            prompt: buildClaimPrompt(claimUrl, projectName),
            expiresAt: entry.expiresAt.toISOString(),
            scope: projectId
              ? { type: "project" as const, projectId, projectName }
              : { type: "all-projects" as const },
          });
        } catch (error) {
          set.status = 500;
          return errorResponse(
            error instanceof Error ? error.message : "Failed to create agent connection prompt",
            500,
          );
        }
      },
      {
        body: t.Object({
          projectId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
          agentName: t.Optional(t.String({ maxLength: 120 })),
        }),
      },
    )
    .get("/", async ({ activeWorkspace, user }) => {
      const orgId = activeWorkspace!.id;
      const userId = (user as { id: string }).id;
      const keys = await listApiKeys(orgId, userId);

      return successResponse(
        keys
          .filter((key) => key.name.startsWith(EXTERNAL_AGENT_KEY_PREFIX))
          .map((key) => ({
            id: key.id,
            name: stripExternalAgentPrefix(key.name),
            keyPrefix: key.keyPrefix,
            isActive: key.isActive,
            verificationStatus: key.lastUsedAt ? "verified" : "pending",
            lastUsedAt: toIso(key.lastUsedAt),
            createdAt: toIso(key.createdAt),
          })),
      );
    })
    .delete(
      "/:id",
      async ({ params, set, activeWorkspace, user }) => {
        const orgId = activeWorkspace!.id;
        const userId = (user as { id: string }).id;
        const keys = await listApiKeys(orgId, userId);
        const connection = keys.find(
          (key) => key.id === params.id && key.name.startsWith(EXTERNAL_AGENT_KEY_PREFIX),
        );

        if (!connection) {
          set.status = 404;
          return notFoundResponse("Agent connection");
        }

        const revoked = await revokeApiKey(orgId, params.id);

        if (!revoked) {
          set.status = 404;
          return notFoundResponse("Agent connection");
        }

        return successResponse({ revoked: true });
      },
      {
        params: t.Object({ id: t.String() }),
      },
    );

const claimHandler = async ({ params, set }: { params: { token: string }; set: { status?: number | string } }) => {
  const result = consumeAgentConnectionLinkToken(params.token);

  if (!result.ok) {
    if (result.reason === "already_claimed") {
      if (result.claimResult) {
        return successResponse(result.claimResult);
      }

      set.status = 409;
      return errorResponse("Agent connection link has already been claimed");
    }

    set.status = 404;
    return notFoundResponse("Agent connection link");
  }

  try {
    const { entry } = result;
    const apiKey = await createApiKey(
      entry.workspaceId,
      `${EXTERNAL_AGENT_KEY_PREFIX} ${entry.agentName}`,
      {
        userId: entry.userId,
        allowedIssuedPermissions: MCP_PERMISSIONS,
      },
    );
    const mcpConfig = buildMcpConfig(entry.baseUrl, entry.projectId, apiKey.key);
    const claimResult = {
      status: "claimed",
      agentName: entry.agentName,
      projectId: entry.projectId,
      scope: entry.projectId
        ? { type: "project" as const, projectId: entry.projectId, projectName: entry.projectName }
        : { type: "all-projects" as const },
      apiKeyId: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      mcpConfig,
      instructions: [
        "Configura un MCP server llamado `almirant` con el objeto `mcpConfig` devuelto.",
        "No pegues ni registres el valor del header Authorization; trátalo como secreto.",
        entry.projectId
          ? `Después de configurar MCP, verifica la conexión llamando a \`list_projects\`. Debe devolverte únicamente el proyecto "${entry.projectName ?? entry.projectId}".`
          : "Después de configurar MCP, verifica la conexión llamando a `list_projects`, explora los proyectos disponibles y confirma cuál usar si la tarea no lo deja claro.",
      ],
    };

    completeAgentConnectionLinkTokenClaim(params.token, claimResult);

    return successResponse(claimResult);
  } catch (error) {
    releaseAgentConnectionLinkTokenClaim(params.token);
    set.status = 500;
    return errorResponse(
      error instanceof Error ? error.message : "Failed to claim agent connection",
      500,
    );
  }
};

const claimRoutes = (prefix: string) =>
  new Elysia({ prefix }).get("/claim/:token", claimHandler, {
    params: t.Object({ token: t.String() }),
  });

const publicRoutes = () =>
  new Elysia()
    // Root path supports direct-to-backend/dev URLs.
    .use(claimRoutes("/agent-connections"))
    // /api path supports self-hosted frontend/proxy URLs where /api/* is routed
    // to the backend without requiring a browser session.
    .use(claimRoutes("/api/agent-connections"));

export const agentConnectionsRoutes = {
  protected: protectedRoutes,
  public: publicRoutes,
};
