"use client";

import { X, Sparkles, ArrowRight, TerminalSquare, Check, Bot, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";
import { ProviderSelectorPopover } from "@/domains/agents/presentation/components/provider-selector-popover";
import type { SelectionActionBarProps } from "../../domain/types";

export const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
  selectedCount,
  onGeneratePrompt,
  onClearSelection,
  isGenerating,
  columns,
  onBulkMove,
  onBatchImplement,
  isMoving,
  cliCommand,
  onCopyCliCommand,
  cliCommandCopied,
}) => {
  const t = useTranslations("workItems.selection");
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 md:gap-3 bg-card border rounded-lg shadow-lg px-3 md:px-4 py-2 md:py-2.5">
      <span className="text-sm font-medium">
        {t("selected", { count: selectedCount })}
      </span>

      {/* Bulk Move dropdown — always visible */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={isMoving}>
            <ArrowRight className="h-4 w-4 mr-1.5" />
            {isMoving ? t("moving") : t("bulkMove")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          {columns.map((col) => (
            <DropdownMenuItem key={col.id} onClick={() => onBulkMove(col.id)}>
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: col.color }}
              />
              {col.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Desktop: all actions visible */}
      <div className="hidden md:flex items-center gap-3">
        {/* Implement with AI — 3-step selector (agent → provider → model) */}
        <ProviderSelectorPopover
          onSelect={({ provider, codingAgent, model }) =>
            onBatchImplement(provider, codingAgent, model)
          }
          actionLabel={t("implementWithAi")}
          trigger={
            <Button size="sm" variant="outline">
              <Bot className="h-4 w-4 mr-1.5" />
              {t("implementWithAi")}
            </Button>
          }
        />

        {/* CLI command */}
        {cliCommand && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" onClick={onCopyCliCommand}>
                {cliCommandCopied ? (
                  <Check className="h-4 w-4 mr-1.5 text-green-500" />
                ) : (
                  <TerminalSquare className="h-4 w-4 mr-1.5" />
                )}
                {cliCommandCopied ? t("commandCopied") : t("copyCommand")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <code className="text-xs">{cliCommand}</code>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Generate combined prompt */}
        <Button size="sm" onClick={onGeneratePrompt} disabled={isGenerating}>
          <Sparkles className="h-4 w-4 mr-1.5" />
          {isGenerating ? t("generating") : t("generateCombinedPrompt")}
        </Button>
      </div>

      {/* Mobile: Implement with AI visible + overflow menu for secondary actions */}
      <div className="flex md:hidden items-center gap-2">
        {/* Implement with AI — 3-step selector (agent → provider → model) */}
        <ProviderSelectorPopover
          onSelect={({ provider, codingAgent, model }) =>
            onBatchImplement(provider, codingAgent, model)
          }
          actionLabel={t("implementWithAi")}
          actionAriaLabel={t("implementWithAi")}
        />

        {/* Overflow menu for other actions */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {/* CLI command */}
            {cliCommand && (
              <DropdownMenuItem onClick={onCopyCliCommand}>
                {cliCommandCopied ? (
                  <Check className="h-4 w-4 mr-1.5 text-green-500" />
                ) : (
                  <TerminalSquare className="h-4 w-4 mr-1.5" />
                )}
                {cliCommandCopied ? t("commandCopied") : t("copyCommand")}
              </DropdownMenuItem>
            )}

            {/* Generate combined prompt */}
            <DropdownMenuItem onClick={onGeneratePrompt} disabled={isGenerating}>
              <Sparkles className="h-4 w-4 mr-1.5" />
              {isGenerating ? t("generating") : t("generateCombinedPrompt")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Clear selection — always visible */}
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClearSelection} aria-label="Clear selection">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};
