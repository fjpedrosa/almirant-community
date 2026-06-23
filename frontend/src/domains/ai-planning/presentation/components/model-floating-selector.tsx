import { useState, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ChevronDown, ChevronLeft } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getModelsGroupedByCategory, findModelById } from "@/lib/ai-models-catalog";
import type { ModelDefinition } from "@/domains/integrations/domain/types";
import { CODING_AGENT_ICON_MAP, getProviderIcon } from "@/domains/shared/presentation/utils/provider-icons";
import {
  CODING_AGENT_OPTIONS,
  getProvidersForAgent,
  agentProviderToAiProvider,
} from "@/domains/agents/domain/coding-agent-compatibility";
import type { CodingAgent } from "@/domains/agents/domain/coding-agent-compatibility";
import { useCodingAgentBetaAccess } from "@/domains/agents/application/hooks/use-coding-agent-beta-access";
import type { ModelFloatingSelectorProps } from "../../domain/types";

type Step = "agent" | "provider" | "model";

const CATEGORY_CONFIG: Record<string, { label: string; className: string }> = {
  best: { label: "Best", className: "bg-amber-500/15 text-amber-400" },
  fast: { label: "Fast", className: "bg-sky-500/15 text-sky-400" },
  cheap: { label: "Affordable", className: "bg-emerald-500/15 text-emerald-400" },
  reasoning: { label: "Reasoning", className: "bg-violet-500/15 text-violet-400" },
};

export const ModelFloatingSelector: React.FC<ModelFloatingSelectorProps> = ({
  providerKeys,
  selectedKeyId,
  selectedModel,
  hasKeys,
  isLoading,
  onKeyChange,
  onModelChange,
  isSessionActive,
  isSessionCompleted = false,
  activeModelLabel,
  isSidebarOpen = true,
  selectedCodingAgent,
  onCodingAgentChange,
}) => {
  const t = useTranslations("aiPlanning.modelSelector");
  const tCommon = useTranslations("common");
  const { isAgentVisible, isAgentBeta } = useCodingAgentBetaAccess();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>("agent");
  const [pickedAgent, setPickedAgent] = useState<CodingAgent | null>(null);

  const visibleAgentOptions = useMemo(
    () => CODING_AGENT_OPTIONS.filter((o) => isAgentVisible(o.agent)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAgentVisible]
  );

  // All hooks MUST be called before any early return (Rules of Hooks)
  const compatibleKeys = useMemo(() => {
    if (!pickedAgent) return providerKeys;
    const compatibleAgentProviders = getProvidersForAgent(pickedAgent);
    const compatibleAiProviders = compatibleAgentProviders.map(agentProviderToAiProvider);
    return providerKeys.filter((k) => compatibleAiProviders.includes(k.provider));
  }, [pickedAgent, providerKeys]);

  const resetState = useCallback(() => {
    setStep("agent");
    setPickedAgent(null);
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setIsOpen(nextOpen);
      if (!nextOpen) resetState();
    },
    [resetState]
  );

  const handleAgentClick = useCallback(
    (agent: CodingAgent) => {
      setPickedAgent(agent);
      onCodingAgentChange?.(agent);

      const compatibleAgentProviders = getProvidersForAgent(agent);
      const compatibleAiProviders = compatibleAgentProviders.map(agentProviderToAiProvider);
      const keys = providerKeys.filter((k) => compatibleAiProviders.includes(k.provider));

      if (keys.length === 1) {
        onKeyChange(keys[0].id);
        setStep("model");
      } else {
        setStep("provider");
      }
    },
    [providerKeys, onKeyChange, onCodingAgentChange]
  );

  const handleProviderClick = useCallback(
    (keyId: string) => {
      onKeyChange(keyId);
      setStep("model");
    },
    [onKeyChange]
  );

  const handleModelClick = useCallback(
    (model: string) => {
      onModelChange(model);
      setIsOpen(false);
      resetState();
    },
    [onModelChange, resetState]
  );

  const handleBack = useCallback(() => {
    if (step === "model") {
      if (compatibleKeys.length <= 1) {
        setStep("agent");
        setPickedAgent(null);
      } else {
        setStep("provider");
      }
    } else if (step === "provider") {
      setStep("agent");
      setPickedAgent(null);
    }
  }, [step, compatibleKeys.length]);

  if (isLoading) return null;

  const isReadOnly = isSessionActive || isSessionCompleted;
  const modelDef = selectedModel ? findModelById(selectedModel) : null;
  const displayLabel = modelDef?.displayName || selectedModel || t("model");

  const positionClass = isSidebarOpen ? "left-4" : "left-12";
  const topClass = "top-14 md:top-3";

  if (isReadOnly) {
    const agentLabel = selectedCodingAgent
      ? CODING_AGENT_OPTIONS.find((o) => o.agent === selectedCodingAgent)?.label
      : null;
    return (
      <div className={cn("absolute z-10 transition-all duration-300", topClass, positionClass)}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent backdrop-blur-sm border border-border/50 px-3 h-8 text-sm text-muted-foreground shadow-sm">
          {agentLabel && <span className="text-foreground">{agentLabel}</span>}
          {agentLabel && <span className="opacity-40">/</span>}
          {displayLabel}
        </span>
      </div>
    );
  }

  if (!hasKeys) {
    return (
      <div className={cn("absolute z-10 transition-all duration-300", topClass, positionClass)}>
        <Link
          href="/settings/provider-keys"
          className="inline-flex items-center gap-1.5 rounded-full bg-accent backdrop-blur-sm border border-border/50 px-4 py-2.5 min-h-[44px] text-sm text-muted-foreground hover:text-foreground hover:brightness-125 transition-colors shadow-sm"
        >
          {t("configureKeys")}
        </Link>
      </div>
    );
  }

  const selectedKey = providerKeys.find((k) => k.id === selectedKeyId);
  const modelsGrouped = selectedKey
    ? getModelsGroupedByCategory(selectedKey.provider)
    : {};

  const agentLabel = selectedCodingAgent
    ? CODING_AGENT_OPTIONS.find((o) => o.agent === selectedCodingAgent)?.label
    : null;

  return (
    <div className={cn("absolute z-10 transition-all duration-300", topClass, positionClass)}>
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full bg-accent backdrop-blur-sm border border-border/50 px-4 py-2.5 min-h-[44px] text-sm text-foreground hover:brightness-125 transition-colors cursor-pointer shadow-sm"
          >
            {agentLabel && (
              <>
                <span className="truncate max-w-[100px] text-muted-foreground">{agentLabel}</span>
                <span className="opacity-40">/</span>
              </>
            )}
            <span className="truncate max-w-[160px]">{displayLabel}</span>
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={4} className="w-[260px] p-1 overflow-hidden">
          {step === "agent" && (
            <>
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Select agent
              </div>
              <div className="flex flex-col">
                {visibleAgentOptions.map(({ agent, label }) => {
                  const AgentIcon = CODING_AGENT_ICON_MAP[agent];
                  const isSelected = agent === selectedCodingAgent;
                  const isBeta = isAgentBeta(agent);
                  return (
                    <button
                      key={agent}
                      type="button"
                      className={cn(
                        "flex items-center gap-2 rounded-sm px-2 py-2.5 min-h-[44px] text-sm hover:bg-accent transition-colors text-left",
                        isSelected && "bg-accent/50"
                      )}
                      onClick={() => handleAgentClick(agent)}
                    >
                      <AgentIcon className="h-4 w-4 text-foreground" />
                      <span className="text-sm">{label}</span>
                      {isSelected && (
                        <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">Current</Badge>
                      )}
                      {!isSelected && isBeta && (
                        <Badge
                          variant="outline"
                          className="ml-auto h-4 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide bg-primary/10 border-primary/30 text-primary"
                        >
                          {tCommon("betaBadge")}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === "provider" && (
            <>
              <div className="flex items-center gap-1 px-2 py-1.5">
                <button type="button" className="p-1.5 rounded-sm hover:bg-accent transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center" onClick={handleBack} aria-label="Back">
                  <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <span className="text-xs font-medium text-muted-foreground">Select provider</span>
              </div>
              <div className="flex flex-col">
                {compatibleKeys.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                    <p>No API keys configured</p>
                    <Link href="/settings/provider-keys" className="text-primary hover:underline text-xs">
                      Configure keys
                    </Link>
                  </div>
                ) : (
                  compatibleKeys.map((key) => (
                    <button
                      key={key.id}
                      type="button"
                      onClick={() => handleProviderClick(key.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-sm px-2 py-2.5 min-h-[44px] text-sm hover:bg-accent transition-colors text-left",
                        key.id === selectedKeyId && "bg-accent/50"
                      )}
                    >
                      {getProviderIcon(key.provider, "size-4 shrink-0")}
                      <span className="truncate">{key.name}</span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}

          {step === "model" && (
            <>
              <div className="flex items-center gap-1 px-2 py-1.5">
                <button type="button" className="p-1.5 rounded-sm hover:bg-accent transition-colors min-h-[32px] min-w-[32px] flex items-center justify-center" onClick={handleBack} aria-label="Back">
                  <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
                <span className="text-xs font-medium text-muted-foreground">Select model</span>
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                {(() => {
                  const allModels = (Object.entries(modelsGrouped) as [string, ModelDefinition[]][]).flatMap(([, models]) => models);
                  const shownCategories = new Set<string>();
                  return allModels.map((model) => {
                    const isFirst = !shownCategories.has(model.category);
                    if (isFirst) shownCategories.add(model.category);
                    const cat = isFirst ? CATEGORY_CONFIG[model.category] : null;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        onClick={() => handleModelClick(model.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-2.5 min-h-[44px] text-sm hover:bg-accent transition-colors cursor-pointer",
                          model.id === selectedModel && "bg-accent text-accent-foreground",
                        )}
                      >
                        <span className="truncate">{model.displayName}</span>
                        {cat && (
                          <span className={cn("text-[10px] font-medium uppercase tracking-wide rounded-full px-1.5 py-0.5 shrink-0", cat.className)}>
                            {cat.label}
                          </span>
                        )}
                      </button>
                    );
                  });
                })()}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
};
