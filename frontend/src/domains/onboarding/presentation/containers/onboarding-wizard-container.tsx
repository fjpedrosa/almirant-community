"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/domains/auth/application/hooks/use-auth";
import { useOnboardingWizard } from "../../application/hooks/use-onboarding-wizard";
import { WizardShell } from "../components/wizard-shell";
import { StepAdminCard } from "../components/step-admin-card";
import { StepTailscaleCard } from "../components/step-tailscale-card";
import { StepGithubCard } from "../components/step-github-card";

const OnboardingWizardContent = () => {
  const { user } = useAuth();
  const {
    isCloud,
    visibleSteps,
    isLoading,
    error,
    currentStep,
    handleStepChange,
    adminDone,
    tailscaleDone,
    githubDone,
    publicUrl,
    canComplete,
    isCompleting,
    handleComplete,
    adminUserCount,
    tailscale,
    isSkippingTailscale,
    handleSkipTailscale,
    githubApp,
    isSkippingGithub,
    handleSkipGithub,
  } = useOnboardingWizard();

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-96 items-center justify-center">
        <p className="text-destructive">
          {error instanceof Error ? error.message : "Error loading status"}
        </p>
      </div>
    );
  }

  return (
    <WizardShell
      steps={visibleSteps}
      subtitleKey={isCloud ? "subtitleCloud" : "subtitle"}
      currentStep={currentStep}
      onStepChange={handleStepChange}
      adminDone={adminDone}
      tailscaleDone={tailscaleDone}
      githubDone={githubDone}
      canComplete={canComplete}
      isCompleting={isCompleting}
      onComplete={handleComplete}
    >
      {currentStep === "admin" && (
        <StepAdminCard
          userCount={adminUserCount}
          adminEmail={user?.email ?? ""}
        />
      )}

      {currentStep === "tailscale" && (
        <StepTailscaleCard
          activeTab={tailscale.activeTab}
          onTabChange={tailscale.setActiveTab}
          available={tailscale.status?.available ?? false}
          hostname={tailscale.status?.hostname ?? null}
          suggestedUrl={tailscale.status?.suggestedUrl ?? null}
          reason={tailscale.status?.reason}
          publicUrl={publicUrl}
          isServing={tailscale.isServing}
          onServe={tailscale.handleServe}
          serveResult={tailscale.serveResult}
          manualUrl={tailscale.manualUrl}
          onManualUrlChange={tailscale.setManualUrl}
          isSavingUrl={tailscale.isSavingUrl}
          onSaveManualUrl={tailscale.handleSaveManualUrl}
          detectedPublicUrl={tailscale.detectedPublicUrl}
          onUseDetectedPublicUrl={tailscale.handleUseDetectedPublicUrl}
          isSkipping={isSkippingTailscale}
          onSkip={handleSkipTailscale}
          done={tailscaleDone}
        />
      )}

      {currentStep === "github" && (
        <StepGithubCard
          activeTab={githubApp.activeTab}
          onTabChange={githubApp.setActiveTab}
          hasPublicUrl={!!publicUrl}
          isCreatingApp={githubApp.isCreatingApp}
          onCreateViaManifest={githubApp.handleManifestFlow}
          manifestForm={githubApp.manifestForm}
          onManifestFormChange={githubApp.handleManifestFormChange}
          isManifestSubmittable={githubApp.isManifestSubmittable}
          isTailscaleFunnel={githubApp.isTailscaleFunnel}
          formValues={githubApp.formValues}
          onFormValueChange={githubApp.handleFormValueChange}
          isSaving={githubApp.isSaving}
          onSaveManual={githubApp.handleSaveManual}
          configured={githubApp.configured}
          appSlug={githubApp.appSlug}
          hasInstallations={githubApp.hasInstallations}
          githubInstallUrl={githubApp.githubInstallUrl}
          isSyncingInstallations={githubApp.isSyncingInstallations}
          onInstallGithubApp={githubApp.handleInstallGithubApp}
          onSyncInstallations={githubApp.handleSyncInstallations}
          onCreateProject={githubApp.handleCreateProject}
          isSkipping={isSkippingGithub}
          onSkip={handleSkipGithub}
          done={githubDone}
        />
      )}
    </WizardShell>
  );
};

export const OnboardingWizardContainer = () => {
  return (
    <Suspense
      fallback={
        <div className="flex h-96 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <OnboardingWizardContent />
    </Suspense>
  );
};
