import { Elysia } from "elysia";
import { env } from "@almirant/config";
import { db, schema, and, eq } from "@almirant/database";

/**
 * Normalize a Playwright project name before it participates in fixture
 * identity. E2E projects must never share a mutable session/workspace.
 */
export const devAuthFixtureScope = (project?: string): string => {
  const normalized = (project ?? "default")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return normalized || "default";
};

export const signDevSessionCookieValue = async (token: string, secret: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)));
  return encodeURIComponent(`${token}.${btoa(String.fromCharCode(...signature))}`);
};

const ensureDevUser = async (email: string, name: string) => {
  const [existing] = await db.select().from(schema.user).where(eq(schema.user.email, email)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(schema.user).values({
    id: crypto.randomUUID(),
    name,
    email,
    emailVerified: true,
    role: "user",
    locale: "es",
  }).returning();
  return created;
};

const ensureDevMembership = async (userId: string, workspaceId: string, role: "admin" | "member") => {
  const [existing] = await db.select({ id: schema.member.id }).from(schema.member).where(and(
    eq(schema.member.userId, userId),
    eq(schema.member.workspaceId, workspaceId),
  )).limit(1);
  if (existing) return;
  await db.insert(schema.member).values({
    id: crypto.randomUUID(),
    workspaceId,
    userId,
    role,
    createdAt: new Date(),
  });
};

const ensureDevSession = async (userId: string, workspaceId: string) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [existing] = await db.select().from(schema.session).where(eq(schema.session.userId, userId)).limit(1);
  if (existing) {
    const active = new Date(existing.expiresAt) > now;
    const [updated] = await db.update(schema.session).set({
      activeWorkspaceId: workspaceId,
      ...(active ? {} : { token: crypto.randomUUID(), expiresAt }),
    }).where(eq(schema.session.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(schema.session).values({
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    expiresAt,
    userId,
    ipAddress: "127.0.0.1",
    userAgent: "playwright-e2e",
    activeWorkspaceId: workspaceId,
  }).returning();
  return created;
};

/**
 * Dev-only endpoint to create a test user + session for E2E testing.
 * Returns a session token that can be used as `better-auth.session_token` cookie.
 *
 * DISABLED in production (returns 404).
 */
export const devAuthRoutes = new Elysia({ prefix: "/dev" }).post(
  "/test-session",
  async ({ query }) => {
    if (env.NODE_ENV === "production") {
      return new Response("Not Found", { status: 404 });
    }
    if (!env.BETTER_AUTH_SECRET) {
      return new Response(
        JSON.stringify({ success: false, error: "BETTER_AUTH_SECRET is required for test sessions" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    const scope = devAuthFixtureScope(query.project);
    const scopedSuffix = scope === "default" ? "" : `-${scope}`;
    const testUser = await ensureDevUser(`test${scopedSuffix}@almirant.local`, "Test User");

    if (!testUser) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create test user" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Ensure test user belongs to a workspace (required by dashboard layout).
    const [existingMember] = await db.select().from(schema.member).where(eq(schema.member.userId, testUser.id)).limit(1);

    let orgId: string | null = existingMember?.workspaceId ?? null;

    if (!orgId || scope !== "default") {
      const scopedSlug = `playwright-notes-${scope}`;
      let [workspace] = await db
        .select({ id: schema.workspace.id })
        .from(schema.workspace)
        .where(eq(schema.workspace.slug, scopedSlug))
        .limit(1);
      if (!workspace) {
        [workspace] = await db.insert(schema.workspace).values({
          id: crypto.randomUUID(),
          name: `Playwright Notes ${scope}`,
          slug: scopedSlug,
        }).returning({ id: schema.workspace.id });
      }
      orgId = workspace?.id ?? null;
      if (orgId) await ensureDevMembership(testUser.id, orgId, "admin");
    }

    if (!orgId) {
      let [workspace] = await db.select({ id: schema.workspace.id }).from(schema.workspace).limit(1);
      if (!workspace) {
        [workspace] = await db.insert(schema.workspace).values({
          id: crypto.randomUUID(),
          name: "Playwright Notes",
          slug: `playwright-notes-${crypto.randomUUID().slice(0, 8)}`,
        }).returning({ id: schema.workspace.id });
      }
      orgId = workspace?.id ?? null;
      if (orgId) await ensureDevMembership(testUser.id, orgId, "admin");
    }
    if (!orgId) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create test workspace" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const viewer = await ensureDevUser(`notes-viewer${scopedSuffix}@almirant.local`, "Notes Viewer");
    if (!viewer) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create viewer user" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    await ensureDevMembership(viewer.id, orgId, "member");
    const [primarySession, viewerSession] = await Promise.all([
      ensureDevSession(testUser.id, orgId),
      ensureDevSession(viewer.id, orgId),
    ]);
    if (!primarySession || !viewerSession) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create test sessions" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    return {
      success: true,
      data: {
        token: await signDevSessionCookieValue(primarySession.token, env.BETTER_AUTH_SECRET),
        userId: testUser.id,
        email: testUser.email,
        expiresAt: primarySession.expiresAt,
        viewerToken: await signDevSessionCookieValue(viewerSession.token, env.BETTER_AUTH_SECRET),
        viewerUserId: viewer.id,
        viewerEmail: viewer.email,
      },
    };
  }
);
