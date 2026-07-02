/**
 * One-off script: Provision a default "runner" service account for every
 * workspace that does not already have one.
 *
 * Usage:
 *   bun run backend/packages/database/scripts/provision-existing-orgs.ts
 *
 * Requires DATABASE_URL in the environment (reads from backend/api/.env
 * automatically when run from project root via bun).
 */

import { db, closeConnections } from "../src/client";
import { workspace } from "../src/schema/workspace";
import { provisionDefaultServiceAccount } from "../src/repositories/service-account-repository";

const main = async () => {
  console.log("[provision-existing-orgs] Starting...");

  const orgs = await db.select({ id: workspace.id, name: workspace.name }).from(workspace);
  console.log(`[provision-existing-orgs] Found ${orgs.length} workspace(s).`);

  let provisioned = 0;
  let skipped = 0;
  let failed = 0;

  for (const org of orgs) {
    try {
      const result = await provisionDefaultServiceAccount(org.id);
      if (result) {
        provisioned++;
        console.log(`  [OK] Provisioned SA for org "${org.name}" (${org.id})`);
        console.log(`        Key: ${result.key}`);
      } else {
        skipped++;
        console.log(`  [SKIP] Org "${org.name}" (${org.id}) already has a runner SA`);
      }
    } catch (error) {
      failed++;
      console.error(
        `  [FAIL] Org "${org.name}" (${org.id}):`,
        error instanceof Error ? error.message : error
      );
    }
  }

  console.log(
    `\n[provision-existing-orgs] Done. Provisioned: ${provisioned}, Skipped: ${skipped}, Failed: ${failed}`
  );

  await closeConnections();
};

main().catch((err) => {
  console.error("[provision-existing-orgs] Fatal error:", err);
  process.exit(1);
});
