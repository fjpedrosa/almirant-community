import { Suspense } from "react";
import { QueryProvider } from "@/components/providers/query-provider";
import { PostHogProvider } from "@/components/providers/posthog-provider";
import { PostHogSetup } from "@/components/providers/posthog-setup";
import { Toaster } from "@/components/ui/sonner";
import { NavigationContainer } from "./components/navigation-container";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WebSocketProvider } from "@/domains/shared/presentation/containers/websocket-provider";
import { ActiveOrgProvider } from "@/domains/teams/application/active-org-context";
import { pickActiveOrgId } from "@/domains/teams/domain/active-org";
import { onboardingServerApi } from "@/lib/api/server-client";
import {
  authBackendFetch,
  forwardSetCookies,
  getServerSession,
} from "@/lib/server-session";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { OnboardingBannerContainer } from "@/domains/onboarding/presentation/containers/onboarding-banner-container";
import { VersionUpdateBannerContainer } from "@/domains/shared/presentation/containers/version-update-banner-container";
import { DashboardSkeleton } from "@/components/skeletons";
import { isCloudDeployment } from "@/lib/deployment-mode";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const reqHeaders = await headers();
  const session = await getServerSession();

  if (!session) {
    redirect("/sign-in");
  }

  // Auto-select an active organization if the session has none.
  // This covers existing users who registered before auto-org creation was added,
  // or sessions that were created without the session.create.before hook.
  //
  // Auth lives on the backend now, so we call the Better-Auth organization
  // endpoints directly (forwarding cookies). Per Better-Auth: `organization/list`
  // is GET, `organization/set-active` is POST { organizationId }. `set-active`
  // persists the active org to the session row server-side; any returned
  // Set-Cookie is best-effort propagated (a no-op during RSC render).
  // Active-org id seeded down to client hooks so `useOrgScopedKey` scopes to the
  // real workspace from render 0 (no `org:none` phase → no double fetch).
  // Agnostic to the build: community seeds off `activeOrganizationId`, the cloud
  // fork off its renamed `activeWorkspaceId` (see `pickActiveOrgId`).
  let activeOrgId = pickActiveOrgId(session.session);

  if (!activeOrgId) {
    try {
      const listRes = await authBackendFetch("/organization/list");

      if (listRes.ok) {
        const orgs = (await listRes.json()) as Array<{ id: string }> | null;
        const firstOrg = orgs?.[0];

        if (firstOrg) {
          const setActiveRes = await authBackendFetch("/organization/set-active", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ organizationId: firstOrg.id }),
          });

          await forwardSetCookies(setActiveRes);
          // The backend has persisted this as the active org for the session, so
          // seed it now (the in-memory `session` above still reads null).
          activeOrgId = firstOrg.id;
        }
      }
    } catch {
      // Non-critical: org auto-selection failed; the user can switch manually
    }
  }

  // Onboarding redirect logic:
  // - If onboarding not completed and admin step done → redirect to /onboarding
  // - If onboarding completed → let them through to dashboard
  // - Show banner if there are pending steps
  const pathname = reqHeaders.get("x-pathname") ?? "";
  let showOnboardingBanner = false;

  if (!pathname.startsWith("/onboarding") && !pathname.startsWith("/projects/new")) {
    let onboardingComplete = true;
    let hasPendingSteps = false;

    try {
      const status = await onboardingServerApi.getStatus();
      onboardingComplete = !!status.completedAt;

      // Count pending steps (not done and not skipped). In cloud the admin
      // account and public URL are managed by the platform, so only the GitHub
      // App step can be pending — never nag about tailscale/admin there.
      hasPendingSteps = isCloudDeployment()
        ? !status.github.done && !status.github.skipped
        : (!status.tailscale.done && !status.tailscale.skipped) ||
          (!status.github.done && !status.github.skipped);
    } catch {
      // Non-critical: if onboarding API fails, don't block the user
    }

    if (!onboardingComplete && hasPendingSteps) {
      showOnboardingBanner = true;
    }
  }

  return (
    <PostHogProvider>
      <QueryProvider>
        <ActiveOrgProvider initialActiveOrgId={activeOrgId ?? null}>
        <WebSocketProvider>
          <TooltipProvider delayDuration={300}>
            <PostHogSetup />
            <div className="flex h-dvh flex-col overflow-hidden bg-background">
              <div className="shrink-0">
                <NavigationContainer />
              </div>
              {showOnboardingBanner && (
                <div className="shrink-0">
                  <OnboardingBannerContainer />
                </div>
              )}
              <div className="shrink-0">
                <VersionUpdateBannerContainer />
              </div>
              <Suspense
                fallback={
                  <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
                    <DashboardSkeleton />
                  </main>
                }
              >
                <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
                  {children}
                </main>
              </Suspense>
            </div>
            <Toaster />
          </TooltipProvider>
        </WebSocketProvider>
        </ActiveOrgProvider>
      </QueryProvider>
    </PostHogProvider>
  );
}
