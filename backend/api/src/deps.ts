import { db } from "@almirant/database";
import { wsConnectionManager } from "./shared/ws/ws-connection-manager";

export type AppDeps = {
  db: typeof db;
  ws: typeof wsConnectionManager;
};

export const createDeps = (): AppDeps => ({
  db,
  ws: wsConnectionManager,
});
