import { Elysia } from "elysia";
import { env } from "@almirant/config";
import { db, schema, eq } from "@almirant/database";

/**
 * Dev-only endpoint to create a test user + session for E2E testing.
 * Returns a session token that can be used as `better-auth.session_token` cookie.
 *
 * DISABLED in production (returns 404).
 */
export const devAuthRoutes = new Elysia({ prefix: "/dev" }).post(
  "/test-session",
  async () => {
    if (env.NODE_ENV === "production") {
      return new Response("Not Found", { status: 404 });
    }

    const testEmail = "test@almirant.local";
    const testName = "Test User";

    // Find or create test user
    let [testUser] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, testEmail))
      .limit(1);

    if (!testUser) {
      [testUser] = await db
        .insert(schema.user)
        .values({
          id: crypto.randomUUID(),
          name: testName,
          email: testEmail,
          emailVerified: true,
          role: "user",
          locale: "es",
        })
        .returning();
    }

    if (!testUser) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create test user" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Ensure test user belongs to a workspace (required by dashboard layout).
    const [existingMember] = await db
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, testUser.id))
      .limit(1);

    let orgId: string | null = existingMember?.workspaceId ?? null;

    if (!orgId) {
      // Find any existing workspace to join
      const [anyOrg] = await db
        .select({ id: schema.workspace.id })
        .from(schema.workspace)
        .limit(1);

      if (anyOrg) {
        orgId = anyOrg.id;
        await db
          .insert(schema.member)
          .values({
            id: crypto.randomUUID(),
            workspaceId: orgId,
            userId: testUser.id,
            role: "admin",
            createdAt: new Date(),
          })
          .onConflictDoNothing();
      }
    }

    // Find existing non-expired session or create a new one
    const now = new Date();
    const [existingSession] = await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, testUser.id))
      .limit(1);

    if (existingSession && new Date(existingSession.expiresAt) > now) {
      // Ensure active org is set
      if (!existingSession.activeWorkspaceId && orgId) {
        await db
          .update(schema.session)
          .set({ activeWorkspaceId: orgId })
          .where(eq(schema.session.id, existingSession.id));
      }
      return {
        success: true,
        data: {
          token: existingSession.token,
          userId: testUser.id,
          email: testUser.email,
          expiresAt: existingSession.expiresAt,
        },
      };
    }

    // Create new session (7 day expiry)
    const token = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [newSession] = await db
      .insert(schema.session)
      .values({
        id: crypto.randomUUID(),
        token,
        expiresAt,
        userId: testUser.id,
        ipAddress: "127.0.0.1",
        userAgent: "playwright-e2e",
        activeWorkspaceId: orgId,
      })
      .returning();

    if (!newSession) {
      return new Response(
        JSON.stringify({ success: false, error: "Failed to create session" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return {
      success: true,
      data: {
        token: newSession.token,
        userId: testUser.id,
        email: testUser.email,
        expiresAt: newSession.expiresAt,
      },
    };
  }
);
