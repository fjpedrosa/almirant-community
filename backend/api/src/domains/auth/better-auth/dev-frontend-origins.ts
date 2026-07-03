// Ported from frontend `src/lib/runtime-service-url.ts` — only the
// `getDefaultLocalFrontendOrigins` helper is needed by the backend auth issuer
// to seed Better-Auth `trustedOrigins` with the local dev frontend origins.

const LOCALHOST_FRONTEND_ORIGIN = "http://localhost:3000";
const ORBSTACK_FRONTEND_ORIGIN = "https://frontend.almirant.orb.local";

type EnvLike = { NODE_ENV?: string };

export const getDefaultLocalFrontendOrigins = (
  env: EnvLike = process.env,
): string[] =>
  env.NODE_ENV === "production"
    ? []
    : [LOCALHOST_FRONTEND_ORIGIN, ORBSTACK_FRONTEND_ORIGIN];
