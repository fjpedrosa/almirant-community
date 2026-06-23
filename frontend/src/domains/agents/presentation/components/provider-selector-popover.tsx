"use client";

import { useState, useMemo, useCallback } from "react";
import { Bot, Loader2, ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { PROVIDER_OPTIONS, CODING_AGENT_ICON_MAP } from "@/domains/shared/presentation/utils/provider-icons";
import {
  CODING_AGENT_OPTIONS,
  getProvidersForAgent,
  isSingleProviderAgent,
  defaultCodingAgentForProvider,
  getModelsForAgentProvider,
} from "../../domain/coding-agent-compatibility";
import type { CodingAgent } from "../../domain/coding-agent-compatibility";
import type { AgentProvider } from "../../domain/types";
import { RepoSelector } from "./repo-selector";
import type { ProviderSelectorPopoverProps } from "../../domain/types";
import { useCodingAgentBetaAccess } from "../../application/hooks/use-coding-agent-beta-access";

type Step = "agent" | "provider" | "model";

const CATEGORY_BADGES: Record<string, { label: string; className: string }> = {
  best: { label: "Best", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  fast: { label: "Fast", className: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  cheap: { label: "Affordable", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  reasoning: { label: "Reasoning", className: "bg-violet-500/15 text-violet-600 dark:text-violet-400" },
};

export const ProviderSelectorPopover: React.FC<ProviderSelectorPopoverProps> = ({
  onSelect,
  isPending,
  disabled,
  repos,
  selectedRepoId,
  onRepoSelect,
  actionLabel,
  actionAriaLabel,
  defaultProvider,
  showModelStep = true,
  trigger: customTrigger,
}) => {
  const t = useTranslations("agents");
  const tCommon = useTranslations("common");
  const { isAgentVisible, isAgentBeta } = useCodingAgentBetaAccess();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("agent");
  const [selectedAgent, setSelectedAgent] = useState<CodingAgent | null>(null);
  const [selectedProviderVal, setSelectedProviderVal] = useState<AgentProvider | null>(null);

  const hasMultipleRepos = repos && repos.length >= 2;

  const defaultCodingAgent = defaultProvider
    ? defaultCodingAgentForProvider(defaultProvider)
    : null;

  const sortedAgentOptions = useMemo(() => {
    const visible = CODING_AGENT_OPTIONS.filter((o) => isAgentVisible(o.agent));
    if (!defaultCodingAgent) return visible;
    return [...visible].sort((a, b) => {
      if (a.agent === defaultCodingAgent) return -1;
      if (b.agent === defaultCodingAgent) return 1;
      return 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCodingAgent, isAgentVisible]);

  const resetState = useCallback(() => {
    setStep("agent");
    setSelectedAgent(null);
    setSelectedProviderVal(null);
  }, []);

  const finishSelection = useCallback(
    (agent: CodingAgent, provider: AgentProvider, model?: string) => {
      onSelect({ codingAgent: agent, provider, model });
      setOpen(false);
      resetState();
    },
    [onSelect, resetState]
  );

  const handleAgentClick = useCallback(
    (agent: CodingAgent) => {
      if (isSingleProviderAgent(agent)) {
        const providers = getProvidersForAgent(agent);
        if (showModelStep) {
          setSelectedAgent(agent);
          setSelectedProviderVal(providers[0]);
          setStep("model");
        } else {
          finishSelection(agent, providers[0]);
        }
      } else {
        setSelectedAgent(agent);
        setStep("provider");
      }
    },
    [showModelStep, finishSelection]
  );

  const handleProviderClick = useCallback(
    (provider: AgentProvider) => {
      if (!selectedAgent) return;
      if (showModelStep) {
        setSelectedProviderVal(provider);
        setStep("model");
      } else {
        finishSelection(selectedAgent, provider);
      }
    },
    [selectedAgent, showModelStep, finishSelection]
  );

  const handleModelClick = useCallback(
    (modelId: string) => {
      if (!selectedAgent || !selectedProviderVal) return;
      finishSelection(selectedAgent, selectedProviderVal, modelId);
    },
    [selectedAgent, selectedProviderVal, finishSelection]
  );

  const handleBack = useCallback(() => {
    if (step === "model") {
      if (selectedAgent && isSingleProviderAgent(selectedAgent)) {
        setStep("agent");
        setSelectedAgent(null);
        setSelectedProviderVal(null);
      } else {
        setStep("provider");
        setSelectedProviderVal(null);
      }
    } else if (step === "provider") {
      setStep("agent");
      setSelectedAgent(null);
    }
  }, [step, selectedAgent]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) resetState();
    },
    [resetState]
  );

  const defaultTrigger = (
    <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" disabled={disabled} aria-label={actionAriaLabel ?? "Implement with AI"}>
      {isPending ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Bot className="h-4 w-4 text-muted-foreground" />}
    </Button>
  );

  const trigger = customTrigger ?? defaultTrigger;

  const compatibleProviders = useMemo(() => {
    if (!selectedAgent) return [];
    const compatible = getProvidersForAgent(selectedAgent);
    return PROVIDER_OPTIONS.filter((opt) => compatible.includes(opt.provider));
  }, [selectedAgent]);

  const modelsGrouped = useMemo(() => {
    if (!selectedProviderVal) return {};
    const models = getModelsForAgentProvider(selectedProviderVal);
    return models.reduce(
      (acc, model) => {
        if (!acc[model.category]) acc[model.category] = [];
        acc[model.category].push(model);
        return acc;
      },
      {} as Record<string, typeof models>
    );
  }, [selectedProviderVal]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        {disabled ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent>{t("worker.offline")}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        {hasMultipleRepos && onRepoSelect && (
          <>
            <RepoSelector
              repos={repos}
              selectedRepoId={selectedRepoId ?? null}
              onSelect={onRepoSelect}
            />
            <Separator className="my-1" />
          </>
        )}

        {step === "agent" && (
          <>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {actionLabel ? `${actionLabel} — Select agent` : "Select agent"}
            </div>
            <div className="flex flex-col">
              {sortedAgentOptions.map(({ agent, label }) => {
                const isDefault = agent === defaultCodingAgent;
                const isBeta = isAgentBeta(agent);
                const AgentIcon = CODING_AGENT_ICON_MAP[agent];
                return (
                  <button
                    key={agent}
                    type="button"
                    className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left ${isDefault ? "bg-accent/50" : ""}`}
                    onClick={() => handleAgentClick(agent)}
                    disabled={disabled || isPending}
                  >
                    <AgentIcon className="h-4 w-4 text-foreground" />
                    <span className="text-sm">{label}</span>
                    {isDefault && (
                      <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">Default</Badge>
                    )}
                    {!isDefault && isBeta && (
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
              <button type="button" className="p-0.5 rounded-sm hover:bg-accent transition-colors" onClick={handleBack} aria-label="Back">
                <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <span className="text-xs font-medium text-muted-foreground">Select provider</span>
            </div>
            <div className="flex flex-col">
              {compatibleProviders.map(({ provider, label, Icon }) => {
                const isDefault = provider === defaultProvider;
                return (
                  <button
                    key={provider}
                    type="button"
                    className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left ${isDefault ? "bg-accent/50" : ""}`}
                    onClick={() => handleProviderClick(provider)}
                    disabled={disabled || isPending}
                  >
                    <Icon className="h-4 w-4 text-foreground" />
                    <span className="text-sm">{label}</span>
                    {isDefault && (
                      <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0">Default</Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === "model" && (
          <>
            <div className="flex items-center gap-1 px-2 py-1.5">
              <button type="button" className="p-0.5 rounded-sm hover:bg-accent transition-colors" onClick={handleBack} aria-label="Back">
                <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <span className="text-xs font-medium text-muted-foreground">Select model</span>
            </div>
            <div className="flex flex-col max-h-64 overflow-y-auto">
              {Object.entries(modelsGrouped).map(([category, models]) => (
                <div key={category}>
                  {models.map((model) => {
                    const badge = CATEGORY_BADGES[category];
                    return (
                      <button
                        key={model.id}
                        type="button"
                        className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left w-full"
                        onClick={() => handleModelClick(model.id)}
                        disabled={disabled || isPending}
                      >
                        <span className="text-sm truncate">{model.displayName}</span>
                        {badge && (
                          <Badge variant="outline" className={`ml-auto text-[10px] px-1.5 py-0 border-0 ${badge.className}`}>
                            {badge.label}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};
