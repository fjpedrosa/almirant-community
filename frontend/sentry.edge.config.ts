import * as Sentry from "@sentry/nextjs";

const IGNORED_ERRORS = [
  /Failed to get session/i,
  /An error occurred in the Server Components render/i,
];

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
const isDev = process.env.NODE_ENV === "development";

if (dsn && !isDev) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 1,
    enableLogs: true,
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
