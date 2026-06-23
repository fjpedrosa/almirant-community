"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ClaudeCodeSetupProps } from "../../domain/types";
import { CodexIcon } from "@/components/icons/codex-icon";

export const ClaudeCodeSetup: React.FC<ClaudeCodeSetupProps> = ({
  isLoading,
  projectOptions,
  apiKeyOptions,
  selectedProjectId,
  selectedApiKeyId,
  snippet,
  isConnected,
  docsUrl,
  onProjectChange,
  onApiKeyChange,
  onCopySnippet,
}) => {
  const canCopy = snippet.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <CodexIcon className="h-4 w-4" />
              Setup de Codex
            </span>
          </CardTitle>
          <Badge variant={isConnected ? "default" : "secondary"}>
            {isConnected ? "Conectado" : "No conectado"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label>Paso 1: Selecciona proyecto</Label>
          <Select value={selectedProjectId} onValueChange={onProjectChange} disabled={isLoading}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona un proyecto" />
            </SelectTrigger>
            <SelectContent>
              {projectOptions.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Paso 2: Selecciona API key activa</Label>
          <Select value={selectedApiKeyId} onValueChange={onApiKeyChange} disabled={isLoading}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona una API key" />
            </SelectTrigger>
            <SelectContent>
              {apiKeyOptions.map((apiKey) => (
                <SelectItem key={apiKey.id} value={apiKey.id}>
                  {apiKey.name} ({apiKey.keyPrefix}...)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <Label>Paso 3: Copia tu `.mcp.json`</Label>
          <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
            {snippet || "Selecciona proyecto + API key para generar configuración personalizada."}
          </pre>
          <div className="flex gap-2">
            <Button type="button" onClick={onCopySnippet} disabled={!canCopy}>
              Copiar configuración
            </Button>
            <Button asChild variant="outline">
              <Link href={docsUrl} target="_blank" rel="noreferrer">
                Ver documentación completa
              </Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
