"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { connectionsApi, githubApi } from "@/lib/api/client";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function GitHubOAuthCallbackContent() {
  const searchParams = useSearchParams();
  const hasProcessed = useRef(false);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const installationId = searchParams.get("installation_id");
  const setupAction = searchParams.get("setup_action");

  useEffect(() => {
    if (hasProcessed.current) return;
    hasProcessed.current = true;

    const finish = () => {
      if (window.opener && !window.opener.closed) {
        window.close();
        return;
      }
      window.location.href = "/settings/integrations";
    };

    const processCallback = async () => {
      // 1. Connect the GitHub App installation (if present)
      if (installationId && setupAction !== "request") {
        const id = Number(installationId);
        if (Number.isFinite(id) && id > 0) {
          for (let attempt = 1; attempt <= 5; attempt++) {
            try {
              await githubApi.connectInstallation(id);
              showToast.success("GitHub App connected");
              break;
            } catch {
              if (attempt < 5) await sleep(attempt * 1000);
              else showToast.error("Failed to connect GitHub App installation");
            }
          }
        }
      }

      // 2. Exchange OAuth code for user token (if present)
      if (code && state) {
        try {
          await connectionsApi.handleOAuthCallback("github", {
            code,
            state,
            scope: "user",
            category: "code",
            name: "GitHub",
          });
          showToast.success("GitHub account connected");
        } catch {
          showToast.error("Failed to connect GitHub account");
        }
      }

      finish();
    };

    processCallback();
  }, [code, state, installationId, setupAction]);

  return (
    <div className="flex h-full items-center justify-center gap-3">
      <Loader2 className="h-6 w-6 animate-spin" />
      <span className="text-sm text-muted-foreground">Connecting GitHub...</span>
    </div>
  );
}

export default function GitHubOAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <GitHubOAuthCallbackContent />
    </Suspense>
  );
}
