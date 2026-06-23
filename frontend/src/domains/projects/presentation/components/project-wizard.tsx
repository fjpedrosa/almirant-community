"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ProjectWizardProps } from "../../domain/types";
import { WizardStepProjectName } from "./wizard-step-project-name";
import { WizardStepGithubRepo } from "./wizard-step-github-repo";
import { WizardStepCollaborators } from "./wizard-step-collaborators";
import { WizardStepApiKey } from "./wizard-step-api-key";
import { WizardStepVercelDeploy } from "./wizard-step-vercel-deploy";
import { WizardStepSummary } from "./wizard-step-summary";

const SKIPPABLE_STEPS = ["collaborators", "github-repo", "vercel-deploy"];

export const ProjectWizard: React.FC<ProjectWizardProps> = ({
  step,
  stepIndex,
  totalSteps,
  state,
  isGeneratingApiKey,
  isFinishing,
  canProceed,
  onProjectNameChange,
  collaboratorInput,
  onCollaboratorInputChange,
  onAddCollaborator,
  onRemoveCollaborator,
  onGenerateApiKey,
  onCopyApiKey,
  onNext,
  onBack,
  onSkip,
  onFinish,
  // GitHub
  githubInstallations,
  selectedInstallationId,
  onSelectInstallation,
  githubRepos,
  isLoadingGithubRepos,
  selectedRepoFullName,
  onSelectRepo,
  createNewRepo,
  onToggleCreateNew,
  newRepoName,
  onNewRepoNameChange,
  newRepoIsPrivate,
  onTogglePrivate,
  isCreatingRepo,
  githubMode,
  needsOAuthForRepoCreation,
  onConnectGitHub,
  needsGithubReconnect,
  onReconnectGitHub,
  // Vercel
  deployToVercel,
  onToggleDeployToVercel,
  vercelProjectName,
  onVercelProjectNameChange,
}) => {
  const progress = ((stepIndex + 1) / totalSteps) * 100;
  const isSkippable = SKIPPABLE_STEPS.includes(step);

  // Derive the effective repo full name for summary/vercel steps
  const effectiveGithubRepoFullName = selectedRepoFullName ?? null;

  return (
    <Card className="max-w-3xl mx-auto">
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle>Wizard de nuevo proyecto</CardTitle>
          <span className="text-sm text-muted-foreground">
            Paso {stepIndex + 1} de {totalSteps}
          </span>
        </div>
        <Progress value={progress} />
      </CardHeader>
      <CardContent className="space-y-6">
        {step === "project-name" ? (
          <WizardStepProjectName
            projectName={state.projectName}
            onProjectNameChange={onProjectNameChange}
          />
        ) : null}

        {step === "github-repo" ? (
          <WizardStepGithubRepo
            installations={githubInstallations}
            selectedInstallationId={selectedInstallationId}
            onSelectInstallation={onSelectInstallation}
            repos={githubRepos}
            isLoadingRepos={isLoadingGithubRepos}
            selectedRepoFullName={selectedRepoFullName}
            onSelectRepo={onSelectRepo}
            createNewRepo={createNewRepo}
            onToggleCreateNew={onToggleCreateNew}
            newRepoName={newRepoName}
            onNewRepoNameChange={onNewRepoNameChange}
            newRepoIsPrivate={newRepoIsPrivate}
            onTogglePrivate={onTogglePrivate}
            isCreatingRepo={isCreatingRepo}
            githubMode={githubMode}
            needsOAuthForRepoCreation={needsOAuthForRepoCreation}
            onConnectGitHub={onConnectGitHub}
            needsReconnect={needsGithubReconnect}
            onReconnectGitHub={onReconnectGitHub}
          />
        ) : null}

        {step === "collaborators" ? (
          <WizardStepCollaborators
            collaboratorEmails={state.collaboratorEmails}
            collaboratorInput={collaboratorInput}
            onCollaboratorInputChange={onCollaboratorInputChange}
            onAddCollaborator={onAddCollaborator}
            onRemoveCollaborator={onRemoveCollaborator}
          />
        ) : null}

        {step === "api-key" ? (
          <WizardStepApiKey
            apiKey={state.apiKey}
            isGeneratingApiKey={isGeneratingApiKey}
            onGenerateApiKey={onGenerateApiKey}
            onCopyApiKey={onCopyApiKey}
          />
        ) : null}

        {step === "vercel-deploy" ? (
          <WizardStepVercelDeploy
            deployToVercel={deployToVercel}
            onToggleDeployToVercel={onToggleDeployToVercel}
            vercelProjectName={vercelProjectName}
            onVercelProjectNameChange={onVercelProjectNameChange}
            githubRepoFullName={effectiveGithubRepoFullName}
          />
        ) : null}

        {step === "summary" ? (
          <WizardStepSummary
            state={state}
            githubRepoFullName={effectiveGithubRepoFullName}
            deployToVercel={deployToVercel}
            vercelProjectName={vercelProjectName}
          />
        ) : null}

        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" onClick={onBack} disabled={stepIndex === 0}>
            Atras
          </Button>
          <div className="flex gap-2">
            {isSkippable ? (
              <Button type="button" variant="ghost" onClick={onSkip}>
                Skip
              </Button>
            ) : null}

            {step === "summary" ? (
              <Button type="button" onClick={onFinish} disabled={isFinishing}>
                {isFinishing ? "Creando..." : "Finalizar setup"}
              </Button>
            ) : (
              <Button type="button" onClick={onNext} disabled={!canProceed}>
                Siguiente
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
