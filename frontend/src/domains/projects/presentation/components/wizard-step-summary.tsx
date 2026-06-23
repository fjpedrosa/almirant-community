"use client";

import { GitBranch, Rocket } from "lucide-react";
import type { WizardStepSummaryProps } from "../../domain/types";

export const WizardStepSummary: React.FC<WizardStepSummaryProps> = ({
  state,
  githubRepoFullName,
  deployToVercel,
  vercelProjectName,
}) => {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Resumen</h2>
        <p className="text-sm text-muted-foreground">
          Revisa la configuracion final antes de crear el proyecto.
        </p>
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <div>
          <p className="text-xs uppercase text-muted-foreground">Proyecto</p>
          <p className="font-medium">{state.projectName}</p>
        </div>
        {/* GitHub repo */}
        {githubRepoFullName || state.createNewRepo ? (
          <div>
            <p className="text-xs uppercase text-muted-foreground">Repositorio GitHub</p>
            <div className="flex items-center gap-2 mt-1">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">
                {state.createNewRepo
                  ? `${state.newRepoName} (nuevo${state.newRepoIsPrivate ? ", privado" : ", publico"})`
                  : githubRepoFullName}
              </p>
            </div>
          </div>
        ) : null}

        <div>
          <p className="text-xs uppercase text-muted-foreground">Colaboradores</p>
          <p className="text-sm">
            {state.collaboratorEmails.length > 0
              ? state.collaboratorEmails.join(", ")
              : "Sin colaboradores iniciales"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-muted-foreground">API key</p>
          <p className="text-sm">
            {state.apiKey ? `Generada (${state.apiKey.name})` : "No generada en el wizard"}
          </p>
        </div>

        {/* Vercel deploy */}
        {deployToVercel ? (
          <div>
            <p className="text-xs uppercase text-muted-foreground">Deploy Vercel</p>
            <div className="flex items-center gap-2 mt-1">
              <Rocket className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">{vercelProjectName}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
