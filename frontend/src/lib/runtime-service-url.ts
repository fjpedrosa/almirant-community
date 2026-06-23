const LOCALHOST_FRONTEND_ORIGIN = "http://localhost:3000";
const ORBSTACK_FRONTEND_ORIGIN = "https://frontend.almirant.orb.local";
const ORBSTACK_FRONTEND_PREFIX = "frontend.";
const ORBSTACK_SUFFIX = ".orb.local";
const API_SUFFIX = "/api";

type BrowserLocationLike = Pick<Location, "host" | "protocol">;
type EnvLike = { NODE_ENV?: string };

const getHostname = (host: string): string => {
  if (host.startsWith("[")) {
    return host.slice(1, host.indexOf("]"));
  }

  return host.split(":")[0] ?? host;
};

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname.startsWith("127.") ||
  hostname === "::1" ||
  hostname === "0.0.0.0";

const isLoopbackAbsoluteUrl = (value?: string): boolean => {
  if (!value || value.trim().startsWith("/")) return false;

  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
};

const isLoopbackBrowserLocation = (
  locationLike?: BrowserLocationLike
): boolean => {
  if (!locationLike) return false;
  return isLoopbackHostname(getHostname(locationLike.host));
};

const shouldUseSameOriginForLoopbackEnv = (
  envUrl: string | undefined,
  locationLike?: BrowserLocationLike
): boolean =>
  Boolean(
    locationLike &&
      isLoopbackAbsoluteUrl(envUrl) &&
      !isLoopbackBrowserLocation(locationLike)
  );

export const getDefaultLocalFrontendOrigins = (
  env: EnvLike = process.env
): string[] =>
  env.NODE_ENV === "production"
    ? []
    : [LOCALHOST_FRONTEND_ORIGIN, ORBSTACK_FRONTEND_ORIGIN];

const deriveOrbStackServiceHost = (
  host: string,
  serviceName: string
): string | null => {
  if (
    !host.startsWith(ORBSTACK_FRONTEND_PREFIX) ||
    !host.endsWith(ORBSTACK_SUFFIX)
  ) {
    return null;
  }

  return `${serviceName}.${host.slice(ORBSTACK_FRONTEND_PREFIX.length)}`;
};

export const resolveOrbStackServiceOrigin = (
  serviceName: string,
  locationLike?: BrowserLocationLike
): string | null => {
  if (!locationLike) return null;

  const derivedHost = deriveOrbStackServiceHost(locationLike.host, serviceName);
  if (!derivedHost) return null;

  return `${locationLike.protocol}//${derivedHost}`;
};

export const normalizeApiBaseUrl = (apiUrl?: string): string | undefined => {
  const trimmed = apiUrl?.trim();
  if (!trimmed) return undefined;

  let normalized = trimmed.replace(/\/+$/, "");

  while (normalized.endsWith(`${API_SUFFIX}${API_SUFFIX}`)) {
    normalized = normalized.slice(0, -API_SUFFIX.length);
  }

  return normalized;
};

export const resolveBrowserApiBaseUrl = (
  envApiUrl?: string,
  locationLike: BrowserLocationLike | undefined =
    typeof window !== "undefined" ? window.location : undefined
): string => {
  const orbStackOrigin = resolveOrbStackServiceOrigin("backend", locationLike);
  if (orbStackOrigin) {
    return `${orbStackOrigin}/api`;
  }

  if (shouldUseSameOriginForLoopbackEnv(envApiUrl, locationLike)) {
    return "/api";
  }

  return normalizeApiBaseUrl(envApiUrl) || "/api";
};

export const resolveBrowserWsBaseUrl = (
  envWsUrl?: string,
  envApiUrl?: string,
  locationLike: BrowserLocationLike | undefined =
    typeof window !== "undefined" ? window.location : undefined
): string => {
  const orbStackOrigin = resolveOrbStackServiceOrigin("backend", locationLike);
  if (orbStackOrigin) {
    return `${orbStackOrigin.replace(/^http/, "ws")}/ws`;
  }

  if (
    shouldUseSameOriginForLoopbackEnv(envWsUrl, locationLike) ||
    shouldUseSameOriginForLoopbackEnv(envApiUrl, locationLike)
  ) {
    const protocol = locationLike?.protocol === "https:" ? "wss:" : "ws:";
    const host = locationLike?.host ?? "localhost:3000";
    return `${protocol}//${host}/ws`;
  }

  if (envWsUrl) {
    return envWsUrl.replace(/\/+$/, "");
  }

  const normalizedApiUrl = normalizeApiBaseUrl(envApiUrl);
  if (normalizedApiUrl?.startsWith("http")) {
    return normalizedApiUrl.replace(/^http/, "ws").replace(/\/api\/?$/, "");
  }

  const protocol = locationLike?.protocol === "https:" ? "wss:" : "ws:";
  const host = locationLike?.host ?? "localhost:3000";
  return `${protocol}//${host}/ws`;
};
