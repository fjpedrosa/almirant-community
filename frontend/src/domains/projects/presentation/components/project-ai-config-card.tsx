"use client";

import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { XAIIcon } from "@/components/icons/xai-icon";
import { getReasoningEffortOptions } from "@/lib/ai-model-reasoning";
import {
  getProjectRuntimeModels,
  getRetainedProjectRuntimeFields,
  resolveProjectRuntimeAdmission,
} from "../../domain/project-runtime-selection";
import type {
  AiConfigProvider,
  ProjectImplementationAiProvider,
  ProjectImplementationCodingAgent,
} from "../../domain/types";
import {
  ProjectRuntimeRejectionNotice,
  RetainedRuntimeNotice,
  RetainedRuntimeSelectItem,
  retainedRuntimeSelectValue,
  useAiProviderOptions,
  useCodingAgentOptions,
} from "./project-dev-flow-runtime-options";

const PROVIDER_OPTIONS: Array<{
  value: AiConfigProvider | "none";
  label: string;
  icon: React.ReactNode;
}> = [
  { value: "none", label: "No preference", icon: <Bot className="h-4 w-4 text-muted-foreground" /> },
  { value: "claude-code", label: "Claude Code", icon: <ClaudeIcon className="h-4 w-4" /> },
  { value: "codex", label: "Codex", icon: <CodexIcon className="h-4 w-4" /> },
  { value: "zipu", label: "OpenCode / z.ai", icon: <OpenCodeIcon className="h-4 w-4" /> },
  { value: "grok", label: "OpenCode / xAI", icon: <XAIIcon className="h-4 w-4" /> },
];

interface ProjectAiConfigCardProps {
  defaultProvider: string | null;
  implementationDefaults: {
    codingAgent?: string | null;
    aiProvider?: string | null;
    model?: string | null;
    reasoningLevel?: string | null;
  };
  isSaving: boolean;
  hasChanges: boolean;
  errorMessage: string | null;
  onChange: (value: AiConfigProvider | null) => void;
  onCodingAgentChange: (value: ProjectImplementationCodingAgent) => void;
  onAiProviderChange: (value: ProjectImplementationAiProvider) => void;
  onModelChange: (value: string | null) => void;
  onReasoningLevelChange: (value: string | null) => void;
  onSave: () => void;
  onDiscard: () => void;
}

export const ProjectAiConfigCard: React.FC<ProjectAiConfigCardProps> = ({
  defaultProvider,
  implementationDefaults,
  isSaving,
  hasChanges,
  errorMessage,
  onChange,
  onCodingAgentChange,
  onAiProviderChange,
  onModelChange,
  onReasoningLevelChange,
  onSave,
  onDiscard,
}) => {
  const tRuntime = useTranslations("projects.runtimeSelection");
  const selection = {
    codingAgent: implementationDefaults.codingAgent,
    aiProvider: implementationDefaults.aiProvider,
    model: implementationDefaults.model,
    reasoningLevel: implementationDefaults.reasoningLevel,
  };
  const codingAgentOptions = useCodingAgentOptions("implementation");
  const aiProviderOptions = useAiProviderOptions("implementation", selection.codingAgent);
  const modelOptions = getProjectRuntimeModels(
    "implementation",
    selection.codingAgent,
    selection.aiProvider,
  );
  const reasoningOptions = getReasoningEffortOptions(selection);
  const retainedFields = getRetainedProjectRuntimeFields("implementation", selection);
  const retainedByField = new Map(retainedFields.map((field) => [field.field, field.value]));
  const admission = resolveProjectRuntimeAdmission("implementation", selection);
  const hasRetainedLegacyProvider = defaultProvider !== null &&
    !PROVIDER_OPTIONS.some((option) => option.value === defaultProvider);

  const codingAgentValue = retainedByField.has("codingAgent")
    ? retainedRuntimeSelectValue("codingAgent", selection.codingAgent)
    : selection.codingAgent ?? "";
  const aiProviderValue = retainedByField.has("aiProvider")
    ? retainedRuntimeSelectValue("aiProvider", selection.aiProvider)
    : selection.aiProvider ?? "";
  const modelValue = retainedByField.has("model")
    ? retainedRuntimeSelectValue("model", selection.model)
    : selection.model ?? "";
  const reasoningValue = retainedByField.has("reasoningLevel")
    ? retainedRuntimeSelectValue("reasoningLevel", selection.reasoningLevel)
    : selection.reasoningLevel ?? "__default__";

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">AI Configuration</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

        <div className="space-y-1.5">
          <Label htmlFor="ai-default-provider" className="text-xs text-muted-foreground">
            Legacy default runner
          </Label>
          <Select
            value={hasRetainedLegacyProvider
              ? retainedRuntimeSelectValue("legacyRunner", defaultProvider)
              : defaultProvider ?? "none"}
            onValueChange={(value) =>
              onChange(value === "none" ? null : value as AiConfigProvider)
            }
            disabled={isSaving}
          >
            <SelectTrigger id="ai-default-provider" className="h-9 w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hasRetainedLegacyProvider && (
                <RetainedRuntimeSelectItem field="legacyRunner" value={defaultProvider} />
              )}
              {PROVIDER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex items-center gap-2">{option.icon}{option.label}</div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasRetainedLegacyProvider && (
            <RetainedRuntimeNotice field="legacyRunner" value={defaultProvider} />
          )}
        </div>

        <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
          <div>
            <p className="text-sm font-medium">Default implementation runtime</p>
            <p className="text-xs text-muted-foreground">
              Used by backlog automation unless an individual schedule overrides it.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Coding agent</Label>
              <Select
                value={codingAgentValue}
                onValueChange={(value) => onCodingAgentChange(value as ProjectImplementationCodingAgent)}
                disabled={isSaving}
              >
                <SelectTrigger className="h-9" aria-label="Coding agent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {retainedByField.has("codingAgent") && (
                    <RetainedRuntimeSelectItem field="codingAgent" value={selection.codingAgent} />
                  )}
                  {codingAgentOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">{option.icon}{option.label}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">AI provider</Label>
              <Select
                value={aiProviderValue}
                onValueChange={(value) => onAiProviderChange(value as ProjectImplementationAiProvider)}
                disabled={isSaving || aiProviderOptions.length === 0}
              >
                <SelectTrigger className="h-9" aria-label="AI provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {retainedByField.has("aiProvider") && (
                    <RetainedRuntimeSelectItem field="aiProvider" value={selection.aiProvider} />
                  )}
                  {aiProviderOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">{option.icon}{option.label}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Model</Label>
              <Select
                value={modelValue}
                onValueChange={(value) => onModelChange(value || null)}
                disabled={isSaving || modelOptions.length === 0}
              >
                <SelectTrigger className="h-9" aria-label="Model">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {retainedByField.has("model") && (
                    <RetainedRuntimeSelectItem field="model" value={selection.model} />
                  )}
                  {modelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>{model.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Reasoning effort</Label>
              <Select
                value={reasoningValue}
                onValueChange={(value) => onReasoningLevelChange(value === "__default__" ? null : value)}
                disabled={isSaving || reasoningOptions.length === 0}
              >
                <SelectTrigger className="h-9" aria-label="Reasoning effort">
                  <SelectValue placeholder="Default" />
                </SelectTrigger>
                <SelectContent>
                  {retainedByField.has("reasoningLevel") && (
                    <RetainedRuntimeSelectItem field="reasoningLevel" value={selection.reasoningLevel} />
                  )}
                  <SelectItem value="__default__">Default runtime behavior</SelectItem>
                  {reasoningOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {retainedFields.map((field) => (
            <RetainedRuntimeNotice key={field.field} field={field.field} value={field.value} />
          ))}
          {!admission.admitted && selection.codingAgent && selection.aiProvider && selection.model && (
            <ProjectRuntimeRejectionNotice code={admission.code} />
          )}
          {selection.codingAgent === "pi" && admission.admitted && (
            <p className="text-xs text-muted-foreground">{tRuntime("piExactTuple")}</p>
          )}
        </div>

        {isSaving && <p className="text-xs text-muted-foreground">Saving...</p>}
      </CardContent>

      {hasChanges && (
        <CardFooter className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" size="sm" onClick={onDiscard} disabled={isSaving}>Discard</Button>
          <Button size="sm" onClick={onSave} disabled={isSaving}>Save Changes</Button>
        </CardFooter>
      )}
    </Card>
  );
};
