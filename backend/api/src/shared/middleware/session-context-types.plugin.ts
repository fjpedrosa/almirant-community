import { Elysia } from "elysia";
import type { schema } from "@almirant/database";
import type { ActiveWorkspace } from "./session-auth.middleware";

type SessionUser = typeof schema.user.$inferSelect;

/**
 * Type-only plugin used by route modules so handlers can access
 * session-derived fields (`user`, `activeWorkspace`, `memberRole`)
 * even when middleware is attached at app composition time.
 */
export const sessionContextTypes = new Elysia({ name: "session-context-types" }).derive(
  { as: "scoped" },
  () =>
    ({}) as {
      user: SessionUser | null;
      activeWorkspace: ActiveWorkspace | null;
      memberRole: string | null;
    }
);
