import { Elysia } from "elysia";
import { documentsRoutes } from "./routes/documents.routes";
import { documentsSyncRoutes } from "./routes/documents-sync.routes";
import { documentAssetsRoutes } from "./routes/document-assets.routes";
import { uploadsRoutes } from "./routes/uploads.routes";

export const documentsModule = {
  /** Protected routes (session auth, org-scoped) - mounted under /api */
  protected: () => new Elysia().use(documentsRoutes),
  /** Editor upload routes (session auth, org-scoped) - mounted under /api */
  uploads: () => new Elysia().use(uploadsRoutes),
  /** API-key-auth sync routes - mounted outside /api */
  sync: () => new Elysia().use(documentsSyncRoutes),
  /** Public asset serving routes - mounted outside /api */
  assets: () => new Elysia().use(documentAssetsRoutes),
};
