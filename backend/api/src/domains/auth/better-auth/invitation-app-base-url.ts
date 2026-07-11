// Ported from frontend `src/lib/site-url.ts` (only the invitation base-URL
// resolution is needed by the backend auth issuer). Kept verbatim so invitation
// accept links keep the exact same canonicalization behavior as before.

const DEFAULT_SITE_URL = "https://www.almirant.ai";
const CANONICAL_ALMIRANT_HOST = "www.almirant.ai";

const canonicalizeAlmirantHost = (url: URL): URL => {
  if (
    url.hostname !== "almirant.ai" &&
    url.hostname !== CANONICAL_ALMIRANT_HOST
  ) {
    return url;
  }

  return new URL(
    `${url.protocol}//${CANONICAL_ALMIRANT_HOST}${url.pathname}${url.search}${url.hash}`,
  );
};

export const normalizeSiteUrl = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;

  try {
    return canonicalizeAlmirantHost(new URL(withProtocol))
      .toString()
      .replace(/\/$/, "");
  } catch {
    return null;
  }
};

type EnvMap = Record<string, string | undefined>;

export const getInvitationAppBaseUrl = (env: EnvMap = process.env): string => {
  const publicSiteUrl = normalizeSiteUrl(env.NEXT_PUBLIC_SITE_URL);
  if (publicSiteUrl) {
    return publicSiteUrl;
  }

  // The accept-invitation page lives on the FRONTEND, so use the configured
  // frontend origin (first CORS_ORIGIN entry). Do NOT fall back to
  // BETTER_AUTH_URL: that is the API issuer origin (e.g. https://api.almirant.ai
  // in split-origin/cloud deployments) which has no accept-invitation page.
  const corsFrontend = normalizeSiteUrl(env.CORS_ORIGIN?.split(",")[0]);
  if (corsFrontend) {
    return corsFrontend;
  }

  if (env.VERCEL_URL?.trim()) {
    return normalizeSiteUrl(`https://${env.VERCEL_URL}`) ?? DEFAULT_SITE_URL;
  }

  return "http://localhost:3000";
};
