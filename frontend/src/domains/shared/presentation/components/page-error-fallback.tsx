import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PageErrorFallbackProps {
  /** The error that was thrown */
  error: Error & { digest?: string };
  /** Callback to reset the error boundary and retry rendering */
  reset: () => void;
  /** Callback to navigate to home page */
  onGoHome: () => void;
}

/**
 * Error fallback UI for page-level error boundaries.
 *
 * Purely presentational component that displays a user-friendly error message
 * with options to retry or navigate home.
 *
 * Usage in Next.js error.tsx:
 * ```tsx
 * "use client";
 * import { useEffect } from "react";
 * import * as Sentry from "@sentry/nextjs";
 * import { PageErrorFallback } from "@/domains/shared/presentation/components/page-error-fallback";
 *
 * export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
 *   useEffect(() => { Sentry.captureException(error); }, [error]);
 *   return <PageErrorFallback error={error} reset={reset} onGoHome={() => window.location.href = "/"} />;
 * }
 * ```
 */
export function PageErrorFallback({ error, reset, onGoHome }: PageErrorFallbackProps) {

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] px-6 py-12">
      <div className="flex flex-col items-center max-w-md text-center space-y-6">
        {/* Icon */}
        <div className="flex items-center justify-center size-16 rounded-full bg-destructive/10">
          <AlertTriangle className="size-8 text-destructive" />
        </div>

        {/* Message */}
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-foreground">
            Something went wrong
          </h2>
          <p className="text-sm text-muted-foreground">
            We encountered an unexpected error while loading this page. Please
            try again or return to the home page.
          </p>
        </div>

        {/* Error digest (for support reference) */}
        {error.digest && (
          <p className="text-xs text-muted-foreground/60 font-mono">
            Error ID: {error.digest}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onGoHome}>
            <Home className="size-4" />
            Go home
          </Button>
          <Button onClick={reset}>
            <RefreshCw className="size-4" />
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
