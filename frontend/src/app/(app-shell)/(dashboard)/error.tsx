"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { PageErrorFallback } from "@/domains/shared/presentation/components/page-error-fallback";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  const handleGoHome = () => {
    window.location.href = "/";
  };

  return (
    <PageErrorFallback error={error} reset={reset} onGoHome={handleGoHome} />
  );
}
