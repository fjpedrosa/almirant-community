"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ProjectWizard } from "../components/project-wizard";
import { OAuthConnectDialog } from "@/domains/integrations/presentation/components/oauth-connect-dialog";
import { useProjectWizard } from "../../application/hooks/use-project-wizard";
import { useSkipOnboarding } from "@/domains/onboarding/application/hooks/use-onboarding";

export const ProjectWizardContainer: React.FC = () => {
  const wizard = useProjectWizard();
  const skipOnboarding = useSkipOnboarding();

  return (
    <div className="p-6 space-y-6">
      <div className="max-w-3xl mx-auto flex items-center justify-between">
        <Button asChild variant="ghost" className="pl-0">
          <Link href="/projects">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver a proyectos
          </Link>
        </Button>
        <Button
          variant="ghost"
          onClick={() => skipOnboarding.mutate()}
          disabled={skipOnboarding.isPending}
        >
          {skipOnboarding.isPending ? "Saltando..." : "Saltar configuración"}
        </Button>
      </div>

      <ProjectWizard
        step={wizard.step}
        stepIndex={wizard.stepIndex}
        totalSteps={wizard.totalSteps}
        state={wizard.state}
        isGeneratingApiKey={wizard.isGeneratingApiKey}
        isFinishing={wizard.isFinishing}
        canProceed={wizard.canProceed}
        onProjectNameChange={wizard.updateProjectName}
        collaboratorInput={wizard.collaboratorInput}
        onCollaboratorInputChange={wizard.setCollaboratorInput}
        onAddCollaborator={wizard.addCollaborator}
        onRemoveCollaborator={wizard.removeCollaborator}
        onGenerateApiKey={wizard.generateApiKey}
        onCopyApiKey={wizard.copyApiKey}
        onNext={wizard.next}
        onBack={wizard.back}
        onSkip={wizard.skip}
        onFinish={wizard.finish}
        // GitHub
        githubInstallations={wizard.githubInstallations}
        selectedInstallationId={wizard.selectedInstallationId}
        onSelectInstallation={wizard.selectInstallation}
        githubRepos={wizard.githubRepos}
        isLoadingGithubRepos={wizard.isLoadingGithubRepos}
        selectedRepoFullName={wizard.selectedRepoFullName}
        onSelectRepo={wizard.selectRepo}
        createNewRepo={wizard.createNewRepo}
        onToggleCreateNew={wizard.toggleCreateNew}
        newRepoName={wizard.newRepoName}
        onNewRepoNameChange={wizard.setNewRepoName}
        newRepoIsPrivate={wizard.newRepoIsPrivate}
        onTogglePrivate={wizard.togglePrivate}
        isCreatingRepo={wizard.isCreatingRepo}
        githubMode={wizard.githubMode}
        needsOAuthForRepoCreation={wizard.needsOAuthForRepoCreation}
        onConnectGitHub={wizard.connectGitHub}
        needsGithubReconnect={wizard.needsGithubReconnect}
        onReconnectGitHub={wizard.reconnectGitHub}
        // Vercel
        deployToVercel={wizard.deployToVercel}
        onToggleDeployToVercel={wizard.toggleDeployToVercel}
        vercelProjectName={wizard.vercelProjectName}
        onVercelProjectNameChange={wizard.setVercelProjectName}
      />

      {/* OAuth dialog for inline GitHub connection */}
      {wizard.oauthConnect.activeProvider ? (
        <OAuthConnectDialog
          open={wizard.oauthConnect.dialogOpen}
          onOpenChange={(open) => { if (!open) wizard.oauthConnect.closeDialog(); }}
          provider={wizard.oauthConnect.activeProvider}
          providerName={wizard.oauthConnect.providerName}
          providerDescription={wizard.oauthConnect.providerDescription}
          flowStep={wizard.oauthConnect.flowStep}
          error={wizard.oauthConnect.error}
          onConnect={wizard.oauthConnect.handleConnect}
          onCancel={wizard.oauthConnect.closeDialog}
        />
      ) : null}
    </div>
  );
};
