import { Elysia } from "elysia";

/**
 * Downstream distributions (e.g. the hosted Almirant Cloud edition) may
 * replace this module to mount cloud-only routes — feedback ingestion,
 * backoffice/admin surfaces, incident debugging, etc. — without touching
 * `index.ts`.
 *
 * Community keeps the default implementation an empty, inert Elysia
 * instance: mounting it contributes zero routes and changes no observable
 * behavior.
 */
export const cloudRoutes = new Elysia({ name: "cloud-routes" });
