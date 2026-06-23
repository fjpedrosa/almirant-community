"use client";

import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import type { WizardStepApiKeyProps } from "../../domain/types";

export const WizardStepApiKey: React.FC<WizardStepApiKeyProps> = ({
  apiKey,
  isGeneratingApiKey,
  onGenerateApiKey,
  onCopyApiKey,
}) => {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Configurar API key para MCP</h2>
        <p className="text-sm text-muted-foreground">
          Genera una API key para conectar Claude Code con este proyecto.
        </p>
      </div>
      <Button type="button" onClick={onGenerateApiKey} disabled={isGeneratingApiKey}>
        {isGeneratingApiKey ? "Generando..." : "Generar API key"}
      </Button>
      {apiKey ? (
        <div className="rounded-lg border p-4 space-y-3">
          <p className="text-sm font-medium">API key creada: {apiKey.name}</p>
          <code className="block text-xs bg-muted p-3 rounded-md break-all">
            {apiKey.key}
          </code>
          <Button type="button" variant="outline" onClick={onCopyApiKey}>
            <Copy className="h-4 w-4 mr-2" />
            Copiar API key
          </Button>
          <p className="text-xs text-muted-foreground">
            Esta key se muestra una vez. Guárdala en un gestor seguro.
          </p>
        </div>
      ) : null}
    </div>
  );
};
