import * as Sentry from "@sentry/nextjs";

const IGNORED_ERRORS = [
  /Failed to get session/i,
  /ChunkLoadError/i,
  /Loading chunk/i,
  /Failed to fetch dynamically imported module/i,
  /is not defined/i,
  /is not a function/i,
  /failed to find Server Action/i,
  /Hydration failed/i,
  /There was an error while hydrating/i,
  /Text content does not match server-rendered HTML/i,
  /WeakMap keys must be objects or non-registered symbols/i,
];

const isLocalhost =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn && !isLocalhost) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    integrations: [Sentry.replayIntegration()],
    tracesSampleRate: 1,
    enableLogs: true,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    sendDefaultPii: true,
    beforeSend(event) {
      const message =
        event.exception?.values?.[0]?.value ??
        event.message ??
        "";
      if (IGNORED_ERRORS.some((re) => re.test(message))) {
        return null;
      }
      return event;
    },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
