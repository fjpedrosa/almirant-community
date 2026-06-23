"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WizardStepProjectNameProps } from "../../domain/types";

export const WizardStepProjectName: React.FC<WizardStepProjectNameProps> = ({
  projectName,
  onProjectNameChange,
}) => {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Nombre del proyecto</h2>
        <p className="text-sm text-muted-foreground">
          Define el nombre con el que se creará tu espacio de trabajo.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="project-name">Nombre</Label>
        <Input
          id="project-name"
          value={projectName}
          onChange={(event) => onProjectNameChange(event.target.value)}
          placeholder="Ej: Almirant"
          autoFocus
        />
      </div>
    </div>
  );
};
