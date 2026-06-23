"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { githubApi } from "@/lib/api/client";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const connectInstallationWithRetry = async (
  installationId: number,
  maxAttempts = 5,
): Promise<void> => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await githubApi.connectInstallation(installationId);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(attempt * 1000);
      }
    }
  }

  throw lastError;
};

function GithubCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hasProcessed = useRef(false);

  const installationIdParam =
    searchParams.get("installation_id") ?? searchParams.get("installationId");
  const setupAction =
    searchParams.get("setup_action") ?? searchParams.get("setupAction") ?? "install";

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const finish = () => {
      if (window.opener && !window.opener.closed) {
        window.close();
        setTimeout(() => {
          router.push("/settings/github");
        }, 300);
        return;
      }
      router.push("/settings/github");
    };

    const processCallback = async () => {
      if (!installationIdParam) {
        showToast.error("Missing installation id from GitHub callback");
        finish();
        return;
      }

      const installationId = Number(installationIdParam);
      if (!Number.isFinite(installationId) || installationId <= 0) {
        showToast.error("Invalid GitHub installation id");
        finish();
        return;
      }

      if (setupAction === "request") {
        showToast.info("GitHub installation request submitted");
        finish();
        return;
      }

      try {
        await connectInstallationWithRetry(installationId);
        showToast.success("GitHub connected successfully");
      } catch {
        showToast.error("Failed to connect GitHub installation");
      } finally {
        finish();
      }
    };

    processCallback();
  }, [installationIdParam, setupAction, router]);

  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin" />
    </div>
  );
}

export default function GithubCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      }
    >
      <GithubCallbackContent />
    </Suspense>
  );
}
