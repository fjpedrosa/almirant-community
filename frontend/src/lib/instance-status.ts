import { sql } from "drizzle-orm";
import { db } from "./db";

type InstanceOnboardingRow = {
  onboardingCompletedAt: Date | null;
};

type UserCountRow = {
  userCount: number;
};

export interface InstanceOnboardingState {
  completed: boolean;
  hasUsers: boolean;
}

/**
 * Reads the instance onboarding state directly from the database (server-side only).
 * Returns whether onboarding has been completed and whether users exist.
 */
export const getInstanceOnboardingState =
  async (): Promise<InstanceOnboardingState> => {
    const [settingsRows, userCountRows] = await Promise.all([
      db.execute(sql`
      SELECT onboarding_completed_at AS "onboardingCompletedAt"
      FROM instance_settings
      LIMIT 1
    `) as Promise<InstanceOnboardingRow[]>,
      db.execute(sql`
      SELECT count(*)::int AS "userCount"
      FROM "user"
    `) as Promise<UserCountRow[]>,
    ]);

    const completed = settingsRows[0]?.onboardingCompletedAt != null;
    const hasUsers = (userCountRows[0]?.userCount ?? 0) > 0;

    return { completed, hasUsers };
  };
