import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

const queryClient = postgres(connectionString, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: 30,
});

export const db = drizzle(queryClient, { schema });
export { schema, sql };
export type Database = typeof db;

export const closeConnections = async () => {
  await queryClient.end();
};
