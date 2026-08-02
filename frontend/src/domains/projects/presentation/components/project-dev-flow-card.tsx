"use client";

import { useTranslations } from "next-intl";
import { Bot, AlertCircle, ExternalLink } from "lucide-react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getModelsForProvider } from "@/lib/ai-models-catalog";
import { getReasoningEffortOptions } from "@/lib/ai-model-reasoning";
import type {
  ProjectDevFlowCardProps,
  ProjectImplementationAiProvider,
  ProjectImplementationCodingAgent,
} from "../../domain/types";
import { useAiProviderOptions, useCodingAgentOptions } from "./project-dev-flow-runtime-options";
import { DevFlowAutomationRow } from "./project-dev-flow-automation-row";

export const ProjectDevFlowCard: React.FC<ProjectDevFlowCardProps> = ({
  isLoading,
  errorMessage,
  settings,
  isSaving,
  hasChanges,
  automations,
  skippedExistingUserAgents,
  onToggleEnabled,
  onCodingAgentChange,
  onAiProviderChange,
  onModelChange,
  onReasoningLevelChange,
  onMaxConcurrentJobsChange,
  onSave,
  onDiscard,
  onDiagnose,
  onAutomationFieldChange,
  onAutomationScheduleChange,
  onAutomationSave,
  onAutomationDiscard,
  onAutomationResetToDefaults,
  onAutomationAdopt,
}) => {
  const t = useTranslations("projects.devFlow.card");
  const codingAgentOptions = useCodingAgentOptions();
  const aiProviderOptions = useAiProviderOptions();

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-72" />
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const isEnabled = settings.enabled;
  const codingAgent = (settings.codingAgent as ProjectImplementationCodingAgent | null) ?? "claude-code";
  const aiProvider = (settings.aiProvider as ProjectImplementationAiProvider | null) ?? "anthropic";
  const modelOptions = getModelsForProvider(aiProvider, "agent-runtime");
  const reasoningOptions = getReasoningEffortOptions({
    codingAgent,
    aiProvider,
    model: settings.model,
  });
  const fieldsDisabled = !isEnabled || isSaving;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">{t("title")}</CardTitle>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={onToggleEnabled}
            disabled={isSaving}
            aria-label={t("enableAria")}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {errorMessage && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <div className={`space-y-3 transition-opacity ${!isEnabled ? "opacity-50 pointer-events-none" : ""}`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("fields.codingAgent")}</Label>
              <Select
                value={codingAgent}
                onValueChange={(value) => onCodingAgentChange(value as ProjectImplementationCodingAgent)}
                disabled={fieldsDisabled}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {codingAgentOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">{option.icon}{option.label}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("fields.aiProvider")}</Label>
              <Select
                value={aiProvider}
                onValueChange={(value) => onAiProviderChange(value as ProjectImplementationAiProvider)}
                disabled={fieldsDisabled}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {aiProviderOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">{option.icon}{option.label}</div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("fields.model")}</Label>
              <Select
                value={settings.model ?? ""}
                onValueChange={(value) => onModelChange(value || null)}
                disabled={fieldsDisabled}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("selectModelPlaceholder")} />
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
              <Label className="text-xs text-muted-foreground">{t("fields.reasoningEffort")}</Label>
              <Select
                value={settings.reasoningLevel ?? "__default__"}
                onValueChange={(value) => onReasoningLevelChange(value === "__default__" ? null : value)}
                disabled={fieldsDisabled || reasoningOptions.length === 0}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder={t("defaultRuntimeBehavior")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">{t("defaultRuntimeBehavior")}</SelectItem>
                  {reasoningOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dev-flow-max-concurrent-jobs" className="text-xs text-muted-foreground">
                {t("fields.maxConcurrentJobs")}
              </Label>
              <Input
                id="dev-flow-max-concurrent-jobs"
                type="number"
                min={1}
                step={1}
                className="h-9"
                placeholder={t("maxConcurrentJobsPlaceholder")}
                value={settings.maxConcurrentJobs ?? ""}
                onChange={(e) => onMaxConcurrentJobsChange(e.target.value)}
                disabled={fieldsDisabled}
              />
            </div>
          </div>
        </div>

        {skippedExistingUserAgents.length > 0 && (
          <Alert>
            <AlertCircle className="size-4" />
            <AlertDescription>
              {t("conflictWarning", { count: skippedExistingUserAgents.length })}{" "}
              <Link href="/agents" className="inline-flex items-center gap-1 underline underline-offset-2">
                {t("viewScheduledAgents")}
                <ExternalLink className="h-3 w-3" />
              </Link>
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          {automations.map((row) => (
            <DevFlowAutomationRow
              key={row.automationId}
              row={row}
              onDiagnose={onDiagnose}
              onFieldChange={onAutomationFieldChange}
              onScheduleChange={onAutomationScheduleChange}
              onSave={onAutomationSave}
              onDiscard={onAutomationDiscard}
              onResetToDefaults={onAutomationResetToDefaults}
              onAdopt={onAutomationAdopt}
            />
          ))}
        </div>

        {isSaving && <p className="text-xs text-muted-foreground">{t("saving")}</p>}
      </CardContent>

      {hasChanges && (
        <CardFooter className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" size="sm" onClick={onDiscard} disabled={isSaving}>
            {t("discard")}
          </Button>
          <Button size="sm" onClick={onSave} disabled={isSaving}>
            {t("saveChanges")}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
};
