import { db, schema, eq, and, gt } from "@almirant/database";

export interface WsTokenResult {
  user: typeof schema.user.$inferSelect;
  organizationId: string | null;
}

export const validateWsToken = async (
  token: string
): Promise<WsTokenResult | null> => {
  const result = await db
    .select({
      session: schema.session,
      user: schema.user,
    })
    .from(schema.session)
    .innerJoin(schema.user, eq(schema.session.userId, schema.user.id))
    .where(
      and(
        eq(schema.session.token, token),
        gt(schema.session.expiresAt, new Date())
      )
    )
    .limit(1);

  const match = result[0];
  if (!match) return null;

  return {
    user: match.user,
    organizationId: match.session.activeOrganizationId ?? null,
  };
};
