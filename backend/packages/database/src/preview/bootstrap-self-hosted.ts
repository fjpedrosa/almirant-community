/**
 * Backwards-compatible entrypoint for older self-hosted bootstrap references.
 *
 * The real implementation lives in scripts/self-hosted-db-maintenance.ts so
 * both fresh installs and upgrades use the same migration-ledger bridge.
 */
import { maintainSelfHostedDatabase } from "../scripts/self-hosted-db-maintenance";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    "[bootstrap-self-hosted] ERROR: DATABASE_URL environment variable is required.",
  );
  process.exit(1);
}

maintainSelfHostedDatabase(databaseUrl)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[bootstrap-self-hosted] Bootstrap failed:", error);
    process.exit(1);
  });
