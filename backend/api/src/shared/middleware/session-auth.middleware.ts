import { Elysia } from "elysia";
import { db, schema, eq, and, gt, desc, isNotNull } from "@almirant/database";

/**
 * Minimal workspace info injected into the request context when
 * the session has an active workspace.
 */
export interface ActiveWorkspace {
  id: string;
  name: string;
  slug: string;
}

/**
 * better-auth cookie format is "token.signature" — DB stores only the token part.
 * Multiple cookie names may coexist (__Host/__Secure/plain), so we return candidates.
 */
function extractTokenCandidates(request: Request): string[] {
  const rawCandidates: string[] = [];

  // 1. Try Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    rawCandidates.push(authHeader.slice(7));
  }

  // 2. Fallback: read from cookie (handles httpOnly cookies sent by the browser)
  const cookieHeader = request.headers.get("cookie");
  if (cookieHeader) {
    const cookieMap = new Map<string, string>();
    for (const part of cookieHeader.split(";")) {
      const trimmed = part.trim();
      const sep = trimmed.indexOf("=");
      if (sep === -1) continue;
      cookieMap.set(trimmed.slice(0, sep), trimmed.slice(sep + 1));
    }

    const cookieNames = [
      "__Host-better-auth.session_token",
      "__Secure-better-auth.session_token",
      "better-auth.session_token",
    ];

    for (const name of cookieNames) {
      const raw = cookieMap.get(name);
      if (!raw) continue;
      rawCandidates.push(decodeURIComponent(raw));
    }
  }

  const normalized = rawCandidates
    .map((raw) => {
      const dotIndex = raw.indexOf(".");
      return dotIndex !== -1 ? raw.substring(0, dotIndex) : raw;
    })
    .filter(Boolean);

  return [...new Set(normalized)];
}

async function getSessionRowByCandidates(tokens: string[]) {
  for (const token of tokens) {
    const result = await db
      .select({
        user: schema.user,
        session: schema.session,
        workspace: schema.workspace,
        member: schema.member,
      })
      .from(schema.session)
      .innerJoin(schema.user, eq(schema.session.userId, schema.user.id))
      .leftJoin(
        schema.workspace,
        eq(schema.session.activeWorkspaceId, schema.workspace.id)
      )
      .leftJoin(
        schema.member,
        and(
          eq(schema.member.workspaceId, schema.workspace.id),
          eq(schema.member.userId, schema.user.id)
        )
      )
      .where(
        and(
          eq(schema.session.token, token),
          gt(schema.session.expiresAt, new Date())
        )
      )
      .limit(1);

    if (result.length > 0) {
      return result[0]!;
    }
  }

  return null;
}

export const sessionAuthMiddleware = new Elysia({ name: "session-auth" })
  .derive({ as: "scoped" }, async ({ request }) => {
    const tokens = extractTokenCandidates(request);

    if (!tokens.length) {
      return {
        user: null,
        activeWorkspace: null as ActiveWorkspace | null,
        memberRole: null as string | null,
      };
    }

    const row = await getSessionRowByCandidates(tokens);

    if (!row) {
      return {
        user: null,
        activeWorkspace: null as ActiveWorkspace | null,
        memberRole: null as string | null,
      };
    }

    // Security: only trust active workspace if the user is actually a member.
    // If session points to an org where membership is missing (or null), auto-heal
    // by selecting the user's first membership as active workspace.
    if (row.workspace && row.member) {
      const activeWorkspace: ActiveWorkspace = {
        id: row.workspace.id,
        name: row.workspace.name,
        slug: row.workspace.slug,
      };
      const memberRole: string = row.member.role;
      return { user: row.user, activeWorkspace, memberRole };
    }

    // Try to inherit org from user's most recent session that had one
    const [previousSession] = await db
      .select({ activeWorkspaceId: schema.session.activeWorkspaceId })
      .from(schema.session)
      .where(
        and(
          eq(schema.session.userId, row.user.id),
          isNotNull(schema.session.activeWorkspaceId),
        ),
      )
      .orderBy(desc(schema.session.updatedAt))
      .limit(1);

    const candidateOrgId = previousSession?.activeWorkspaceId ?? null;

    // Verify membership for the candidate org, or fall back to oldest membership
    const fallbackMembership = candidateOrgId
      ? await db
          .select({
            role: schema.member.role,
            workspace: schema.workspace,
          })
          .from(schema.member)
          .innerJoin(
            schema.workspace,
            eq(schema.member.workspaceId, schema.workspace.id)
          )
          .where(
            and(
              eq(schema.member.userId, row.user.id),
              eq(schema.member.workspaceId, candidateOrgId),
            ),
          )
          .limit(1)
      : [];

    // If candidate org didn't work, fall back to oldest membership (deterministic)
    const resolvedMembership = fallbackMembership.length > 0
      ? fallbackMembership
      : await db
          .select({
            role: schema.member.role,
            workspace: schema.workspace,
          })
          .from(schema.member)
          .innerJoin(
            schema.workspace,
            eq(schema.member.workspaceId, schema.workspace.id)
          )
          .where(eq(schema.member.userId, row.user.id))
          .orderBy(schema.member.createdAt)
          .limit(1);

    if (!resolvedMembership.length) {
      return {
        user: row.user,
        activeWorkspace: null as ActiveWorkspace | null,
        memberRole: null as string | null,
      };
    }

    const fallback = resolvedMembership[0]!;
    const fallbackOrg = fallback.workspace;

    if (row.session.activeWorkspaceId !== fallbackOrg.id) {
      await db
        .update(schema.session)
        .set({ activeWorkspaceId: fallbackOrg.id })
        .where(eq(schema.session.id, row.session.id));
    }

    return {
      user: row.user,
      activeWorkspace: {
        id: fallbackOrg.id,
        name: fallbackOrg.name,
        slug: fallbackOrg.slug,
      },
      memberRole: fallback.role,
    };
  });

export const requireAuth = new Elysia({ name: "require-auth" })
  .onBeforeHandle({ as: "scoped" }, (ctx) => {
    const user = (ctx as unknown as Record<string, unknown>).user;
    if (!user) {
      ctx.set.status = 401;
      return { success: false, error: "Unauthorized" };
    }
  });

export const requireWorkspace = new Elysia({ name: "require-workspace" })
  .onBeforeHandle({ as: "scoped" }, (ctx) => {
    const activeWorkspace = (ctx as unknown as Record<string, unknown>).activeWorkspace;
    if (!activeWorkspace) {
      ctx.set.status = 403;
      return { success: false, error: "No active workspace" };
    }
  });
