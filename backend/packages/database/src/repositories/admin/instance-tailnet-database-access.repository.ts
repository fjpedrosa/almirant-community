import { db } from "../../client";
import { instanceTailnetDatabaseAccess } from "../../schema/instance-tailnet-database-access";
import type {
  InstanceTailnetDatabaseAccess,
  TailnetDatabaseAccessStatus,
  TailnetDatabaseAuthMethod,
} from "../../schema/instance-tailnet-database-access";
import { eq, sql } from "drizzle-orm";

export interface UpdateInstanceTailnetDatabaseAccessData {
  enabled?: boolean;
  status?: TailnetDatabaseAccessStatus;
  authMethod?: TailnetDatabaseAuthMethod | null;
  hostname?: string;
  tag?: string;
  tailscaleIp?: string | null;
  tailnetName?: string | null;
  lastJobId?: string | null;
  lastError?: string | null;
  encryptedCredentials?: string | null;
  credentialsIv?: string | null;
  credentialsAuthTag?: string | null;
  connectionTestedAt?: Date | null;
  lastConnectedAt?: Date | null;
}

export const getInstanceTailnetDatabaseAccess = async (): Promise<InstanceTailnetDatabaseAccess> => {
  const [existing] = await db.select().from(instanceTailnetDatabaseAccess).limit(1);
  if (existing) return existing;

  const [inserted] = await db
    .insert(instanceTailnetDatabaseAccess)
    .values({})
    .onConflictDoNothing({ target: instanceTailnetDatabaseAccess.singleton })
    .returning();

  if (inserted) return inserted;

  const [row] = await db.select().from(instanceTailnetDatabaseAccess).limit(1);
  if (!row) {
    throw new Error("Failed to initialize instance_tailnet_database_access row");
  }
  return row;
};

export const updateInstanceTailnetDatabaseAccess = async (
  data: UpdateInstanceTailnetDatabaseAccessData,
): Promise<InstanceTailnetDatabaseAccess> => {
  const current = await getInstanceTailnetDatabaseAccess();

  const [updated] = await db
    .update(instanceTailnetDatabaseAccess)
    .set({
      ...data,
      updatedAt: sql`now()`,
    })
    .where(eq(instanceTailnetDatabaseAccess.id, current.id))
    .returning();

  if (!updated) {
    throw new Error("Failed to update instance_tailnet_database_access row");
  }

  return updated;
};
