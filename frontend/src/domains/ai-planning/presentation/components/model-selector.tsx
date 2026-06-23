import { useTranslations } from "next-intl";
import Link from "next/link";
import { Bot, KeyRound, ChevronDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ModelSelectorProps } from "../../domain/types";

// Usage:
// <ModelSelector
//   providerKeys={keys}
//   selectedKeyId={keyId}
//   selectedModel={model}
//   availableModels={models}
//   hasKeys={true}
//   isLoading={false}
//   onKeyChange={handleKeyChange}
//   onModelChange={handleModelChange}
//   compact={false}
// />

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  "openai-compatible": "z.ai",
  zai: "z.ai",
  xai: "xAI",
};

const FullSelectors: React.FC<
  Pick<
    ModelSelectorProps,
    | "providerKeys"
    | "selectedKeyId"
    | "selectedModel"
    | "availableModels"
    | "onKeyChange"
    | "onModelChange"
  >
> = ({
  providerKeys,
  selectedKeyId,
  selectedModel,
  availableModels,
  onKeyChange,
  onModelChange,
}) => {
  const t = useTranslations("aiPlanning.modelSelector");

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
      <Select value={selectedKeyId} onValueChange={onKeyChange}>
        <SelectTrigger className="h-8 text-xs w-full sm:w-[160px]" size="sm">
          <SelectValue placeholder={t("selectProvider")} />
        </SelectTrigger>
        <SelectContent>
          {providerKeys.map((key) => (
            <SelectItem key={key.id} value={key.id}>
              <span className="flex items-center gap-1.5">
                <Bot className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{key.name}</span>
                <span className="text-muted-foreground text-[10px]">
                  ({PROVIDER_LABELS[key.provider] ?? key.provider})
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedKeyId && availableModels.length > 0 && (
        <Select value={selectedModel} onValueChange={onModelChange}>
          <SelectTrigger
            className="h-8 text-xs w-full sm:w-[200px]"
            size="sm"
          >
            <SelectValue placeholder={t("selectModel")} />
          </SelectTrigger>
          <SelectContent>
            {availableModels.map((model) => (
              <SelectItem key={model} value={model}>
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
};

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  providerKeys,
  selectedKeyId,
  selectedModel,
  availableModels,
  hasKeys,
  isLoading,
  onKeyChange,
  onModelChange,
  compact = false,
}) => {
  const t = useTranslations("aiPlanning.modelSelector");

  if (isLoading) {
    return null;
  }

  if (!hasKeys) {
    return (
      <Link
        href="/settings/provider-keys"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <KeyRound className="size-3.5" />
        <span>{t("configureKeys")}</span>
      </Link>
    );
  }

  if (compact) {
    const selectedKey = providerKeys.find((k) => k.id === selectedKeyId);
    const providerLabel = selectedKey
      ? (PROVIDER_LABELS[selectedKey.provider] ?? selectedKey.provider)
      : null;
    const chipLabel =
      providerLabel && selectedModel
        ? `${providerLabel} / ${selectedModel}`
        : providerLabel ?? t("selectProvider");

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${t("selectProvider")}: ${chipLabel}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Bot className="size-3.5 shrink-0" />
            <span className="truncate max-w-[120px] sm:max-w-[180px]">
              {chipLabel}
            </span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="w-[320px] p-3"
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Provider
              </label>
              <Select value={selectedKeyId} onValueChange={onKeyChange}>
                <SelectTrigger className="h-8 text-xs w-full" size="sm">
                  <SelectValue placeholder={t("selectProvider")} />
                </SelectTrigger>
                <SelectContent position="popper" className="z-[60]">
                  {providerKeys.map((key) => (
                    <SelectItem key={key.id} value={key.id}>
                      <span className="flex items-center gap-1.5">
                        <Bot className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{key.name}</span>
                        <span className="text-muted-foreground text-[10px]">
                          ({PROVIDER_LABELS[key.provider] ?? key.provider})
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedKeyId && availableModels.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t("selectModel")}
                </label>
                <Select value={selectedModel} onValueChange={onModelChange}>
                  <SelectTrigger className="h-8 text-xs w-full" size="sm">
                    <SelectValue placeholder={t("selectModel")} />
                  </SelectTrigger>
                  <SelectContent position="popper" className="z-[60]">
                    {availableModels.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <FullSelectors
      providerKeys={providerKeys}
      selectedKeyId={selectedKeyId}
      selectedModel={selectedModel}
      availableModels={availableModels}
      onKeyChange={onKeyChange}
      onModelChange={onModelChange}
    />
  );
};
