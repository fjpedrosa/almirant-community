import { Bot } from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AnthropicIcon } from "@/components/icons/anthropic-icon";
import { ClaudeIcon } from "@/components/icons/claude-icon";
import { CodexIcon } from "@/components/icons/codex-icon";
import { OpenCodeIcon } from "@/components/icons/opencode-icon";
import { OpenAIIcon } from "@/components/icons/openai-icon";
import { XAIIcon } from "@/components/icons/xai-icon";
import { ZAIIcon } from "@/components/icons/zai-icon";
import { getModelsForProvider } from "@/lib/ai-models-catalog";
import { getReasoningEffortOptions } from "@/lib/ai-model-reasoning";
import type {
  AiConfigProvider,
  ProjectImplementationAiProvider,
  ProjectImplementationCodingAgent,
} from "../../domain/types";

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

const CODING_AGENT_OPTIONS: Array<{ value: ProjectImplementationCodingAgent; label: string; icon: React.ReactNode }> = [
  { value: "claude-code", label: "Claude Code", icon: <ClaudeIcon className="h-4 w-4" /> },
  { value: "codex", label: "Codex", icon: <CodexIcon className="h-4 w-4" /> },
  { value: "opencode", label: "OpenCode", icon: <OpenCodeIcon className="h-4 w-4" /> },
];

const AI_PROVIDER_OPTIONS: Array<{ value: ProjectImplementationAiProvider; label: string; icon: React.ReactNode }> = [
  { value: "anthropic", label: "Anthropic", icon: <AnthropicIcon className="h-4 w-4" /> },
  { value: "openai", label: "OpenAI", icon: <OpenAIIcon className="h-4 w-4" /> },
  { value: "zai", label: "z.ai", icon: <ZAIIcon className="h-4 w-4" /> },
  { value: "xai", label: "xAI", icon: <XAIIcon className="h-4 w-4" /> },
];

interface ProjectAiConfigCardProps {
  defaultProvider: AiConfigProvider | null;
  implementationDefaults: {
    codingAgent?: ProjectImplementationCodingAgent | null;
    aiProvider?: ProjectImplementationAiProvider | null;
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
  const aiProvider = implementationDefaults.aiProvider ?? "anthropic";
  const codingAgent = implementationDefaults.codingAgent ?? "claude-code";
  const modelOptions = getModelsForProvider(aiProvider, "agent-runtime");
  const reasoningOptions = getReasoningEffortOptions({
    codingAgent,
    aiProvider,
    model: implementationDefaults.model,
  });

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">AI Configuration</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {errorMessage && (
          <p className="text-sm text-destructive">{errorMessage}</p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="ai-default-provider" className="text-xs text-muted-foreground">
            Legacy default runner
          </Label>
          <Select
            value={defaultProvider ?? "none"}
            onValueChange={(value) =>
              onChange(value === "none" ? null : (value as AiConfigProvider))
            }
            disabled={isSaving}
          >
            <SelectTrigger id="ai-default-provider" className="h-9 w-full sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <div className="flex items-center gap-2">
                    {option.icon}
                    {option.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
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
                value={codingAgent}
                onValueChange={(value) => onCodingAgentChange(value as ProjectImplementationCodingAgent)}
                disabled={isSaving}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CODING_AGENT_OPTIONS.map((option) => (
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
                value={aiProvider}
                onValueChange={(value) => onAiProviderChange(value as ProjectImplementationAiProvider)}
                disabled={isSaving}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AI_PROVIDER_OPTIONS.map((option) => (
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
                value={implementationDefaults.model ?? ""}
                onValueChange={(value) => onModelChange(value || null)}
                disabled={isSaving}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Reasoning effort</Label>
              <Select
                value={implementationDefaults.reasoningLevel ?? "__default__"}
                onValueChange={(value) => onReasoningLevelChange(value === "__default__" ? null : value)}
                disabled={isSaving || reasoningOptions.length === 0}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Default runtime behavior</SelectItem>
                  {reasoningOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {isSaving && (
          <p className="text-xs text-muted-foreground">Saving...</p>
        )}
      </CardContent>

      {hasChanges && (
        <CardFooter className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" size="sm" onClick={onDiscard} disabled={isSaving}>
            Discard
          </Button>
          <Button size="sm" onClick={onSave} disabled={isSaving}>
            Save Changes
          </Button>
        </CardFooter>
      )}
    </Card>
  );
};
