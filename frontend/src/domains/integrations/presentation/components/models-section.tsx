"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getReasoningEffortOptions } from "@/lib/ai-model-reasoning";
import { ChevronRight, Loader2, Save, Settings2 } from "lucide-react";
import type { ModelsSectionProps } from "../../domain/types";

export const ModelsSection: React.FC<ModelsSectionProps> = ({
  provider,
  availableModels,
  modelSettings,
  hasModelChanges,
  isSavingModelSettings,
  onModelSettingChange,
  onSaveModelSettings,
  connectionCount,
  expanded,
  onExpandedChange,
}) => {
  const disabled = connectionCount === 0;

  // Find display names for collapsed summary
  const planningName =
    availableModels.find((m) => m.id === modelSettings.planningModel)
      ?.displayName ||
    modelSettings.planningModel ||
    "Default";
  const implementationName =
    availableModels.find((m) => m.id === modelSettings.implementationModel)
      ?.displayName ||
    modelSettings.implementationModel ||
    "Default";
  const validationName =
    availableModels.find((m) => m.id === modelSettings.validationModel)
      ?.displayName ||
    modelSettings.validationModel ||
    "Default";

  const reasoningOptionsFor = (model: string) =>
    getReasoningEffortOptions({
      codingAgent:
        provider === "anthropic"
          ? "claude-code"
          : provider === "openai"
            ? "codex"
            : "opencode",
      aiProvider: provider,
      model,
    });
  const planningReasoningOptions = reasoningOptionsFor(modelSettings.planningModel);
  const implementationReasoningOptions = reasoningOptionsFor(modelSettings.implementationModel);
  const validationReasoningOptions = reasoningOptionsFor(modelSettings.validationModel);

  return (
    <div className={cn("rounded-md", disabled && "opacity-50")}>
      {/* Row header — click to toggle */}
      <button
        type="button"
        onClick={() => !disabled && onExpandedChange(!expanded)}
        disabled={disabled}
        className={cn(
          "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
          !disabled && "hover:bg-muted/50 cursor-pointer",
          disabled && "cursor-not-allowed",
        )}
      >
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-muted-foreground shrink-0" />
          <span>Models</span>
          {!expanded && (
            <span className="truncate text-xs text-muted-foreground max-w-[280px]">
              {planningName} · {implementationName} · {validationName}
            </span>
          )}
        </div>
        <ChevronRight
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform shrink-0",
            expanded && "rotate-90",
          )}
        />
      </button>

      {/* Expanded content */}
      {expanded && !disabled && availableModels.length > 0 && (
        <div className="px-3 pb-3 pt-1 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Planning Model */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Planning Model
              </p>
              <Select
                value={modelSettings.planningModel || "__default__"}
                onValueChange={(value) =>
                  onModelSettingChange(
                    "planningModel",
                    value === "__default__" ? "" : value,
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select planning model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">
                    Default provider behavior
                  </SelectItem>
                  {availableModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Implementation Model */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Implementation Model
              </p>
              <Select
                value={modelSettings.implementationModel || "__default__"}
                onValueChange={(value) =>
                  onModelSettingChange(
                    "implementationModel",
                    value === "__default__" ? "" : value,
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select implementation model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">
                    Default provider behavior
                  </SelectItem>
                  {availableModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Validation Model */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                Validation Model
              </p>
              <Select
                value={modelSettings.validationModel || "__default__"}
                onValueChange={(value) =>
                  onModelSettingChange(
                    "validationModel",
                    value === "__default__" ? "" : value,
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select validation model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">
                    Default provider behavior
                  </SelectItem>
                  {availableModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Reasoning Budget */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Reasoning Budget
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Planning Reasoning Budget */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Planning
                </p>
                <Select
                  value={modelSettings.planningReasoningBudget || "__default__"}
                  onValueChange={(value) =>
                    onModelSettingChange(
                      "planningReasoningBudget",
                      value === "__default__" ? "" : value,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select budget" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default</SelectItem>
                    {planningReasoningOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Implementation Reasoning Budget */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Implementation
                </p>
                <Select
                  value={modelSettings.implementationReasoningBudget || "__default__"}
                  onValueChange={(value) =>
                    onModelSettingChange(
                      "implementationReasoningBudget",
                      value === "__default__" ? "" : value,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select budget" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default</SelectItem>
                    {implementationReasoningOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Validation Reasoning Budget */}
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  Validation
                </p>
                <Select
                  value={modelSettings.validationReasoningBudget || "__default__"}
                  onValueChange={(value) =>
                    onModelSettingChange(
                      "validationReasoningBudget",
                      value === "__default__" ? "" : value,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select budget" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">Default</SelectItem>
                    {validationReasoningOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Save button — only when changes pending */}
          {hasModelChanges && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={onSaveModelSettings}
                disabled={isSavingModelSettings}
                className="h-8"
              >
                {isSavingModelSettings ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                )}
                Save
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
