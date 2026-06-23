import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;
const client = postgres(connectionString);
const db = drizzle(client, { schema });

async function clearData() {
  console.log("Clearing all data from database...");

  // Clear data in order (respect foreign key constraints)
  console.log("Deleting webhook logs...");
  await db.delete(schema.webhookLogs);

  console.log("Deleting webhooks...");
  await db.delete(schema.webhooks);

  console.log("Deleting tags...");
  await db.delete(schema.tags);

  console.log("Deleting import jobs...");
  await db.delete(schema.importJobs);

  console.log("All data cleared successfully!");

  await client.end();
  process.exit(0);
}

clearData().catch((error) => {
  console.error("Clear data failed:", error);
  process.exit(1);
});
