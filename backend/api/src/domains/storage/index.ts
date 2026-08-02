import { Elysia } from "elysia";
import { userStorageRoutes } from "./routes/user-storage.routes";

export const storageModule = {
  /** Account-scoped routes; mounted after requireAuth and before requireWorkspace. */
  authOnly: () => new Elysia().use(userStorageRoutes),
};
