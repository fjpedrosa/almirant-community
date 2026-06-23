"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useGithubStatus } from "../../application/hooks/use-github-status";
import { useGithubConnect } from "../../application/hooks/use-github-connect";
import { useGithubAppSetup } from "@/domains/onboarding/application/hooks/use-github-app-setup";
import { GithubConnectionStatus } from "../components/github-connection-status";
import { GithubConnectionButton } from "../components/github-connection-button";
import { GithubSetupGuide } from "../components/github-setup-guide";
import { GithubAppSetupForm } from "../components/github-app-setup-form";
import { GithubManageInstallationsLink } from "../components/github-manage-installations-link";
import type { GithubSettingsContainerProps } from "../../domain/types";

export const GithubSettingsContainer: React.FC<
  GithubSettingsContainerProps
> = ({ className, returnTo = "/settings/github" }) => {
  const { data: status, isLoading } = useGithubStatus();
  const githubApp = useGithubAppSetup({ returnTo });
  const {
    handleConnect,
    handleDisconnect,
    syncInstallations,
    isSyncing,
    githubAppSlug,
    githubInstallUrl,
  } = useGithubConnect(githubApp.appSlug);
  const [showReconfigure, setShowReconfigure] = useState(false);

  const defaultStatus = {
    configured: false,
    installations: [],
    linkedRepos: [],
  };

  const connectionStatus = status ?? defaultStatus;
  const isConnected = connectionStatus.installations.length > 0;
  const t = useTranslations("github");

  const isAppConfigured = githubApp.configured;

  return (
    <div className={cn("p-6 space-y-6", className)}>
      <div>
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* When the GitHub App is NOT configured, show the setup form */}
      {!isAppConfigured && !githubApp.isLoading && (
        <GithubAppSetupForm
          activeTab={githubApp.activeTab}
          onTabChange={githubApp.setActiveTab}
          formValues={githubApp.formValues}
          onValueChange={githubApp.handleFormValueChange}
          onSubmit={githubApp.handleSaveManual}
          onManifestClick={githubApp.handleManifestFlow}
          isSubmitting={githubApp.isSaving}
          isManifestDisabled={githubApp.isCreatingApp}
          manifestForm={githubApp.manifestForm}
          onManifestFormChange={githubApp.handleManifestFormChange}
          isManifestSubmittable={githubApp.isManifestSubmittable}
          isTailscaleFunnel={githubApp.isTailscaleFunnel}
          error={null}
          success={false}
        />
      )}

      {/* When configured, show connection controls */}
      {isAppConfigured && (
        <>
          <div className="flex items-center gap-4">
            <GithubConnectionButton
              isConfigured={connectionStatus.configured}
              isConnected={isConnected}
              githubAppSlug={githubAppSlug ?? undefined}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
            />
            {!isConnected && !isLoading && (
              <button
                onClick={syncInstallations}
                disabled={isSyncing}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {isSyncing ? t("checking") : t("alreadyInstalled")}
              </button>
            )}
          </div>

          {githubAppSlug &&
            githubInstallUrl &&
            !isConnected &&
            !isLoading && (
              <GithubSetupGuide
                githubAppSlug={githubAppSlug}
                installUrl={githubInstallUrl}
              />
            )}

          {isConnected && (
            <GithubManageInstallationsLink
              canAddRepositories={!!githubInstallUrl}
              onAddRepositories={handleConnect}
            />
          )}

          <GithubConnectionStatus
            status={connectionStatus}
            isLoading={isLoading}
          />

          {/* Reconfigure button + collapsible form */}
          <div className="border-t pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowReconfigure((prev) => !prev)}
              className="gap-2"
            >
              <Settings2 className="h-4 w-4" />
              {t("appSetup.reconfigure")}
            </Button>

            {showReconfigure && (
              <div className="mt-4">
                <GithubAppSetupForm
                  activeTab={githubApp.activeTab}
                  onTabChange={githubApp.setActiveTab}
                  formValues={githubApp.formValues}
                  onValueChange={githubApp.handleFormValueChange}
                  onSubmit={githubApp.handleSaveManual}
                  onManifestClick={githubApp.handleManifestFlow}
                  isSubmitting={githubApp.isSaving}
                  isManifestDisabled={githubApp.isCreatingApp}
                  manifestForm={githubApp.manifestForm}
                  onManifestFormChange={githubApp.handleManifestFormChange}
                  isManifestSubmittable={githubApp.isManifestSubmittable}
                  isTailscaleFunnel={githubApp.isTailscaleFunnel}
                  error={null}
                  success={false}
                />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
