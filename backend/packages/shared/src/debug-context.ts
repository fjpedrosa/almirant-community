// Shared debug context types used by both frontend (feedback widget) and
// backend (feedback cluster detail). The frontend captures these when a user
// submits feedback via the widget; the backend reads them back when building
// the cluster detail payload for the enriched triage modal.
//
// NOTE: `traceSink` is declared as `unknown[]` here on purpose. In the
// frontend it is strongly typed as `TraceSinkEntry[]` (see
// `frontend/src/domains/debug/application/trace-sink.ts`), but that module
// imports from `@/` paths and must not leak into shared packages that the
// backend consumes. Keeping it as `unknown[]` preserves the wire shape while
// letting the frontend narrow the type locally when needed.

/**
 * Debug context captured when submitting feedback from the widget.
 * Includes browser environment, viewport dimensions, and recent console errors.
 */
export interface DebugContext {
  timestamp: string;
  pageUrl: string;
  pathname: string;
  locale: string;
  userAgent: string;
  language: string;
  /** Parsed operating system name and version (e.g., "macOS 14.3", "Windows 11") */
  platform: string;
  /** Parsed browser name and version (e.g., "Chrome 120", "Safari 17.2") */
  browser: string;
  /** Parsed operating system (e.g., "macOS", "Windows 11", "Android 14") */
  os: string;
  /** CPU architecture (e.g., "arm64", "x86-64") */
  architecture: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  /**
   * Legacy screenshot URL pointing at `/api/uploads/images/<key>`. Kept for
   * backwards compatibility with feedback items created before A-1906. New
   * items set this to null and use `screenshotKey` instead.
   */
  screenshotUrl: string | null;
  /**
   * S3 object key for the feedback screenshot (`feedback-screenshots/<uuid>-<name>`).
   * Added in A-1906 so admins and the original author can view screenshots
   * via `GET /api/feedback-items/:id/screenshot`, independently of the
   * uploader's active workspace.
   */
  screenshotKey?: string | null;
  consoleErrors: string[];
  source: "widget";
  /**
   * Dev-only: ring-buffer of reducer transitions and WS frames (present when
   * NEXT_PUBLIC_DEBUG_TRACE=1). Typed as `unknown[]` in the shared package to
   * avoid frontend-only module imports; the frontend narrows this to
   * `TraceSinkEntry[]` locally when reading it.
   */
  traceSink?: unknown[];
}

/**
 * Simple metadata for basic feedback submissions (no debug context).
 */
export interface FeedbackWidgetSimpleMetadata {
  pageUrl: string;
  locale: string;
  source: "widget";
}
