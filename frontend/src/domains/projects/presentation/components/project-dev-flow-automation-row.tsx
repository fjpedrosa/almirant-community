"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getReasoningEffortOptions } from "@/lib/ai-model-reasoning";
import { formatDevFlowEffectiveSummary } from "../../domain/dev-flow-automation-overrides";
import {
  getProjectRuntimeModels,
  getRetainedProjectRuntimeFields,
  resolveProjectRuntimeAdmission,
} from "../../domain/project-runtime-selection";
import { parseMaxConcurrentJobsInput } from "../../domain/dev-flow";
import type { DevFlowAutomationRowProps } from "../../domain/types";
import {
  ProjectRuntimeRejectionNotice,
  RetainedRuntimeNotice,
  RetainedRuntimeSelectItem,
  retainedRuntimeSelectValue,
  useAiProviderOptions,
  useCodingAgentOptions,
} from "./project-dev-flow-runtime-options";
import { ProjectDevFlowScheduleEditor } from "./project-dev-flow-schedule-editor";

const VERDICT_TINT: Record<"would-dispatch" | "blocked", string> = {
  "would-dispatch": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  blocked: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

/**
 * One expandable "Automated dev flow" automation row (issue #235).
 *
 * Collapsed: name, effective-runtime summary, enabled/disabled badge,
 * Diagnose (unchanged from the pre-#235 card), and Adopt when the row is
 * `isSkippedForUserAgent`. The diagnosis result panel and the Adopt confirm
 * both render outside the collapsible content, so they stay visible whether
 * the row is expanded or not.
 *
 * Expanded: the row's own runtime selects (coding agent, AI provider,
 * model, reasoning effort), a concurrency input, a schedule editor and an
 * individual enabled toggle — every field falls back to a `Default: <value>`
 * placeholder built from `row.effective` when `row.override`'s matching
 * field is `null`, and shows the override as a real value otherwise. When
 * `row.effective`'s own value is `null`/absent (e.g. the card default was
 * never set), the placeholder instead shows a human fallback per field
 * (issue #247) — "No limit" for `maxConcurrentJobs`, and the generic
 * "Default runtime behavior" text for every other select — rather than
 * interpolating the raw `null` into the string. "Reset to defaults" clears
 * every override field for this row in one save; when `row.hasChanges` is
 * true (an unsaved local edit), a Save/Discard footer appears, mirroring
 * the card-level pattern.
 */
export const DevFlowAutomationRow: React.FC<DevFlowAutomationRowProps> = ({
  row,
  onDiagnose,
  onFieldChange,
  onScheduleChange,
  onSave,
  onDiscard,
  onResetToDefaults,
  onAdopt,
}) => {
  const t = useTranslations("projects.devFlow.automationRow");
  const tRuntime = useTranslations("projects.runtimeSelection");
  const [expanded, setExpanded] = useState(false);
  const [isConfirmingAdopt, setIsConfirmingAdopt] = useState(false);

  const { override, effective, diagnosis } = row;

  const resolvedCodingAgent = override.codingAgent ?? effective.codingAgent;
  const resolvedAiProvider = override.aiProvider ?? effective.aiProvider;
  const resolvedModel = override.model ?? effective.model;
  const selection = {
    codingAgent: resolvedCodingAgent,
    aiProvider: resolvedAiProvider,
    model: resolvedModel,
    reasoningLevel: override.reasoningLevel ?? effective.reasoningLevel,
  };
  const codingAgentOptions = useCodingAgentOptions(row.automationId);
  const aiProviderOptions = useAiProviderOptions(row.automationId, resolvedCodingAgent);
  const modelOptions = getProjectRuntimeModels(
    row.automationId,
    resolvedCodingAgent,
    resolvedAiProvider,
  );
  const reasoningOptions = getReasoningEffortOptions(selection);
  const retainedFields = getRetainedProjectRuntimeFields(row.automationId, selection);
  const retainedByField = new Map(retainedFields.map((field) => [field.field, field.value]));
  const admission = resolveProjectRuntimeAdmission(row.automationId, selection);

  const enabledChecked = override.enabled ?? row.enabled;

  const formatLastRun = (lastRunAt: string | null): string =>
    lastRunAt ? formatDistanceToNow(new Date(lastRunAt), { addSuffix: true }) : t("neverRun");

  const diagnoseButtonLabel = (status: DevFlowAutomationRowProps["row"]["diagnosis"]["status"]): string => {
    if (status === "loading") return t("diagnosing");
    if (status === "loaded") return t("rediagnose");
    if (status === "error") return t("retryDiagnosis");
    return t("diagnose");
  };

  // Placeholder for a scalar select's inherited value: shows the concrete
  // effective value when there is one, or the generic "Default runtime
  // behavior" fallback when the effective value itself is null/absent —
  // guards against interpolating a raw `null` into the string even though
  // `ProjectDevFlowAutomationEffective`'s scalar fields are typed non-null
  // (the backend can still send `null` when the card default was never
  // configured, issue #247).
  const inheritedPlaceholder = (value: string | null | undefined): string =>
    value == null ? t("defaultRuntimeBehavior") : t("placeholderDefault", { value });

  const inheritedConcurrencyPlaceholder = (value: number | null | undefined): string =>
    value == null ? t("noLimit") : t("placeholderDefault", { value: String(value) });

  const maxConcurrentInputId = `dev-flow-automation-max-jobs-${row.automationId}`;

  return (
    <div className="rounded-md border p-3 space-y-2">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              aria-expanded={expanded}
              aria-label={expanded ? t("collapse", { name: row.name }) : t("expand", { name: row.name })}
            >
              <ChevronRight
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{row.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {row.isSkippedForUserAgent ? t("coveredByUserAgent") : t("lastRun", { time: formatLastRun(row.lastRunAt) })}
                </span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {formatDevFlowEffectiveSummary(effective)}
                </span>
              </span>
            </button>
          </CollapsibleTrigger>

          <div className="flex items-center gap-2">
            <Badge variant={row.enabled ? "default" : "secondary"} className="text-xs">
              {row.enabled ? t("enabledBadge") : t("disabledBadge")}
            </Badge>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={!row.configId || diagnosis.status === "loading"}
              onClick={() => row.configId && onDiagnose(row.configId)}
              aria-label={t("diagnoseAria", { name: row.name })}
            >
              {diagnosis.status === "loading" && <Loader2 className="h-3 w-3 animate-spin" />}
              {diagnoseButtonLabel(diagnosis.status)}
            </Button>

            {row.isSkippedForUserAgent && !isConfirmingAdopt && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setIsConfirmingAdopt(true)}
              >
                {t("adopt")}
              </Button>
            )}
          </div>
        </div>

        {isConfirmingAdopt && (
          <div className="space-y-2 rounded border border-dashed p-2 text-xs">
            <p className="font-medium">{t("adoptConfirmTitle")}</p>
            <p className="text-muted-foreground">{t("adoptConfirmBody")}</p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                disabled={row.isAdopting}
                onClick={() => onAdopt(row.automationId)}
              >
                {row.isAdopting ? t("adopting") : t("adoptConfirmAction")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={row.isAdopting}
                onClick={() => setIsConfirmingAdopt(false)}
              >
                {t("adoptConfirmCancel")}
              </Button>
            </div>
          </div>
        )}

        {diagnosis.status === "loaded" && diagnosis.result && (
          <div className="space-y-1.5 border-t pt-2">
            <Badge className={`text-xs ${VERDICT_TINT[diagnosis.result.verdict]}`} variant="outline">
              {diagnosis.result.verdict === "would-dispatch" ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <AlertCircle className="h-3 w-3" />
              )}
              {diagnosis.result.verdict === "would-dispatch" ? t("verdictWouldDispatch") : t("verdictBlocked")}
              {diagnosis.result.blockedBy ? `: ${diagnosis.result.blockedBy}` : ""}
            </Badge>
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {diagnosis.result.gates.map((gate) => (
                <li key={gate.gate} className={gate.passed ? undefined : "text-amber-700 dark:text-amber-400"}>
                  {gate.passed ? "✓" : "✗"} {gate.gate}: {gate.detail}
                </li>
              ))}
            </ul>
          </div>
        )}

        {diagnosis.status === "error" && diagnosis.error && (
          <p className="text-xs text-destructive border-t pt-2">{diagnosis.error}</p>
        )}

        <CollapsibleContent className="space-y-3 border-t pt-3 mt-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">{t("fields.enabled")}</Label>
              <Switch
                checked={enabledChecked}
                onCheckedChange={(checked) => onFieldChange(row.automationId, "enabled", checked)}
                disabled={row.isSaving}
                aria-label={t("toggleEnabledAria", { name: row.name })}
              />
              <span className="text-xs text-muted-foreground">
                {override.enabled === null ? t("inherited") : t("overridden")}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={row.isSaving}
              onClick={() => onResetToDefaults(row.automationId)}
            >
              {t("resetToDefaults")}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("fields.codingAgent")}</Label>
              <Select
                value={override.codingAgent !== null && retainedByField.has("codingAgent")
                  ? retainedRuntimeSelectValue("codingAgent", override.codingAgent)
                  : override.codingAgent ?? ""}
                onValueChange={(value) => onFieldChange(row.automationId, "codingAgent", value)}
                disabled={row.isSaving}
              >
                <SelectTrigger className="h-9" aria-label={t("fields.codingAgent")}>
                  <SelectValue placeholder={inheritedPlaceholder(effective.codingAgent)} />
                </SelectTrigger>
                <SelectContent>
                  {override.codingAgent !== null && retainedByField.has("codingAgent") && (
                    <RetainedRuntimeSelectItem field="codingAgent" value={override.codingAgent} />
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
              <Label className="text-xs text-muted-foreground">{t("fields.aiProvider")}</Label>
              <Select
                value={override.aiProvider !== null && retainedByField.has("aiProvider")
                  ? retainedRuntimeSelectValue("aiProvider", override.aiProvider)
                  : override.aiProvider ?? ""}
                onValueChange={(value) => onFieldChange(row.automationId, "aiProvider", value)}
                disabled={row.isSaving || aiProviderOptions.length === 0}
              >
                <SelectTrigger className="h-9" aria-label={t("fields.aiProvider")}>
                  <SelectValue placeholder={inheritedPlaceholder(effective.aiProvider)} />
                </SelectTrigger>
                <SelectContent>
                  {override.aiProvider !== null && retainedByField.has("aiProvider") && (
                    <RetainedRuntimeSelectItem field="aiProvider" value={override.aiProvider} />
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
              <Label className="text-xs text-muted-foreground">{t("fields.model")}</Label>
              <Select
                value={override.model !== null && retainedByField.has("model")
                  ? retainedRuntimeSelectValue("model", override.model)
                  : override.model ?? ""}
                onValueChange={(value) => onFieldChange(row.automationId, "model", value)}
                disabled={row.isSaving || modelOptions.length === 0}
              >
                <SelectTrigger className="h-9" aria-label={t("fields.model")}>
                  <SelectValue placeholder={inheritedPlaceholder(effective.model)} />
                </SelectTrigger>
                <SelectContent>
                  {override.model !== null && retainedByField.has("model") && (
                    <RetainedRuntimeSelectItem field="model" value={override.model} />
                  )}
                  {modelOptions.map((model) => (
                    <SelectItem key={model.id} value={model.id}>{model.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("fields.reasoningEffort")}</Label>
              <Select
                value={override.reasoningLevel !== null && retainedByField.has("reasoningLevel")
                  ? retainedRuntimeSelectValue("reasoningLevel", override.reasoningLevel)
                  : override.reasoningLevel ?? "__default__"}
                onValueChange={(value) =>
                  onFieldChange(row.automationId, "reasoningLevel", value === "__default__" ? null : value)
                }
                disabled={row.isSaving || reasoningOptions.length === 0}
              >
                <SelectTrigger className="h-9" aria-label={t("fields.reasoningEffort")}>
                  <SelectValue placeholder={inheritedPlaceholder(effective.reasoningLevel)} />
                </SelectTrigger>
                <SelectContent>
                  {override.reasoningLevel !== null && retainedByField.has("reasoningLevel") && (
                    <RetainedRuntimeSelectItem field="reasoningLevel" value={override.reasoningLevel} />
                  )}
                  <SelectItem value="__default__">{inheritedPlaceholder(effective.reasoningLevel)}</SelectItem>
                  {reasoningOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={maxConcurrentInputId} className="text-xs text-muted-foreground">
                {t("fields.maxConcurrentJobs")}
              </Label>
              <Input
                id={maxConcurrentInputId}
                type="number"
                min={1}
                step={1}
                className="h-9"
                placeholder={inheritedConcurrencyPlaceholder(effective.maxConcurrentJobs)}
                value={override.maxConcurrentJobs ?? ""}
                onChange={(event) =>
                  onFieldChange(row.automationId, "maxConcurrentJobs", parseMaxConcurrentJobsInput(event.target.value))
                }
                disabled={row.isSaving}
              />
            </div>
          </div>

          {retainedFields.map((field) => (
            <RetainedRuntimeNotice key={field.field} field={field.field} value={field.value} />
          ))}
          {!admission.admitted && selection.codingAgent && selection.aiProvider && selection.model && (
            <ProjectRuntimeRejectionNotice code={admission.code} />
          )}
          {row.automationId === "dod-review" && (
            <p className="text-xs text-muted-foreground">{tRuntime("piReadOnlyUnavailable")}</p>
          )}

          <ProjectDevFlowScheduleEditor
            automationName={row.name}
            value={override.schedule}
            effective={effective.schedule}
            disabled={row.isSaving}
            onChange={(schedule) => onScheduleChange(row.automationId, schedule)}
          />

          {row.hasChanges && (
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={row.isSaving}
                onClick={() => onDiscard(row.automationId)}
              >
                {t("discard")}
              </Button>
              <Button type="button" size="sm" disabled={row.isSaving} onClick={() => onSave(row.automationId)}>
                {row.isSaving ? t("saving") : t("save")}
              </Button>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
