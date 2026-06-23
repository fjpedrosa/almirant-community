import { Elysia } from "elysia";
import { db, schema, eq, and, gt, desc, isNotNull } from "@almirant/database";

/**
 * Minimal organization info injected into the request context when
 * the session has an active organization.
 */
export interface ActiveOrganization {
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
        organization: schema.organization,
        member: schema.member,
      })
      .from(schema.session)
      .innerJoin(schema.user, eq(schema.session.userId, schema.user.id))
      .leftJoin(
        schema.organization,
        eq(schema.session.activeOrganizationId, schema.organization.id)
      )
      .leftJoin(
        schema.member,
        and(
          eq(schema.member.organizationId, schema.organization.id),
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
        activeOrganization: null as ActiveOrganization | null,
        memberRole: null as string | null,
      };
    }

    const row = await getSessionRowByCandidates(tokens);

    if (!row) {
      return {
        user: null,
        activeOrganization: null as ActiveOrganization | null,
        memberRole: null as string | null,
      };
    }

    // Security: only trust active organization if the user is actually a member.
    // If session points to an org where membership is missing (or null), auto-heal
    // by selecting the user's first membership as active organization.
    if (row.organization && row.member) {
      const activeOrganization: ActiveOrganization = {
        id: row.organization.id,
        name: row.organization.name,
        slug: row.organization.slug,
      };
      const memberRole: string = row.member.role;
      return { user: row.user, activeOrganization, memberRole };
    }

    // Try to inherit org from user's most recent session that had one
    const [previousSession] = await db
      .select({ activeOrganizationId: schema.session.activeOrganizationId })
      .from(schema.session)
      .where(
        and(
          eq(schema.session.userId, row.user.id),
          isNotNull(schema.session.activeOrganizationId),
        ),
      )
      .orderBy(desc(schema.session.updatedAt))
      .limit(1);

    const candidateOrgId = previousSession?.activeOrganizationId ?? null;

    // Verify membership for the candidate org, or fall back to oldest membership
    const fallbackMembership = candidateOrgId
      ? await db
          .select({
            role: schema.member.role,
            organization: schema.organization,
          })
          .from(schema.member)
          .innerJoin(
            schema.organization,
            eq(schema.member.organizationId, schema.organization.id)
          )
          .where(
            and(
              eq(schema.member.userId, row.user.id),
              eq(schema.member.organizationId, candidateOrgId),
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
            organization: schema.organization,
          })
          .from(schema.member)
          .innerJoin(
            schema.organization,
            eq(schema.member.organizationId, schema.organization.id)
          )
          .where(eq(schema.member.userId, row.user.id))
          .orderBy(schema.member.createdAt)
          .limit(1);

    if (!resolvedMembership.length) {
      return {
        user: row.user,
        activeOrganization: null as ActiveOrganization | null,
        memberRole: null as string | null,
      };
    }

    const fallback = resolvedMembership[0]!;
    const fallbackOrg = fallback.organization;

    if (row.session.activeOrganizationId !== fallbackOrg.id) {
      await db
        .update(schema.session)
        .set({ activeOrganizationId: fallbackOrg.id })
        .where(eq(schema.session.id, row.session.id));
    }

    return {
      user: row.user,
      activeOrganization: {
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

export const requireOrganization = new Elysia({ name: "require-organization" })
  .onBeforeHandle({ as: "scoped" }, (ctx) => {
    const activeOrganization = (ctx as unknown as Record<string, unknown>).activeOrganization;
    if (!activeOrganization) {
      ctx.set.status = 403;
      return { success: false, error: "No active organization" };
    }
  });
