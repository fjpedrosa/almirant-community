"use client";

import { Bot, ChevronDown, Clock, Coins, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";
import type { AiCostBadgeProps, AiSession } from "../../domain/types";

const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
};

const formatCost = (cost: string): string => {
  const n = parseFloat(cost);
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
};

const formatDuration = (ms: number): string => {
  if (ms <= 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const formatModelCompact = (session: AiSession | undefined): string => {
  if (!session) return "AI";
  const model = session.model.toLowerCase();

  // Anthropic patterns: claude-<family>-<major>-<minor>-<snapshot?>
  if (model.includes("claude-")) {
    const family =
      model.includes("opus") ? "Opus" : model.includes("sonnet") ? "Sonnet" : model.includes("haiku") ? "Haiku" : "Claude";

    const parts = model.split("-").filter(Boolean);
    const familyIndex = parts.findIndex((p) => p === "opus" || p === "sonnet" || p === "haiku");
    const major = familyIndex >= 0 ? parts[familyIndex + 1] : undefined;
    const minor = familyIndex >= 0 ? parts[familyIndex + 2] : undefined;

    if (major && /^[0-9]+$/.test(major)) {
      if (minor && /^[0-9]+$/.test(minor)) return `${family} ${major}.${minor}`;
      return `${family} ${major}`;
    }

    return family;
  }

  // z.ai/GLM patterns.
  if (model.startsWith("glm-z1")) {
    if (model.includes("flash")) return "GLM-Z1 Flash";
    if (model.includes("airx")) return "GLM-Z1 AirX";
    if (model.includes("air")) return "GLM-Z1 Air";
    return "GLM-Z1";
  }
  if (model.startsWith("glm-")) {
    const parts = model.slice(4).split("-").filter(Boolean);
    if (parts.length === 0) return "GLM";

    const rawVersion = parts[0];
    if (rawVersion === "ocr") return "GLM-OCR";

    const formattedVersion = /^[0-9]+(\.[0-9]+)?v$/.test(rawVersion)
      ? `${rawVersion.slice(0, -1)}V`
      : rawVersion.toUpperCase();
    const base = `GLM-${formattedVersion}`;
    const variant = parts[1];

    if (!variant) return base;
    if (variant === "plus") return `${base}+`;
    if (variant === "flash") return `${base} Flash`;
    if (variant === "flashx") return `${base} FlashX`;
    if (variant === "air") return `${base} Air`;
    if (variant === "airx") return `${base} AirX`;
    if (variant === "x") return `${base} X`;
    if (variant === "code") return `${base} Code`;
    if (/^[0-9]+b$/.test(variant)) return `${base} ${variant.toUpperCase()}`;

    return base;
  }

  // OpenAI / other providers: keep compact but recognizable.
  if (model === "gpt-4o" || model.startsWith("gpt-4o-")) return "GPT-4o";
  if (model === "o3-mini") return "o3-mini";
  if (model === "o1") return "o1";

  // Fallback: trim long snapshot ids.
  return session.model.length > 18 ? `${session.model.slice(0, 18)}…` : session.model;
};

const SessionRow: React.FC<{ session: AiSession }> = ({ session }) => (
  <div className="flex items-center justify-between py-1.5 px-2 text-xs text-muted-foreground border-b last:border-b-0">
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] bg-muted px-1 rounded">
        {session.model}
      </span>
      <span>{formatTokens(session.totalTokens)} tokens</span>
    </div>
    <div className="flex items-center gap-3">
      <span>{formatCost(session.estimatedCost)}</span>
      {session.durationMs && (
        <span className="flex items-center gap-0.5">
          <Clock className="h-2.5 w-2.5" />
          {formatDuration(session.durationMs)}
        </span>
      )}
      <span className="text-[10px]">{formatDate(session.createdAt)}</span>
    </div>
  </div>
);

export const AiCostBadge: React.FC<AiCostBadgeProps> = ({
  summary,
  sessions,
  compact = false,
}) => {
  const t = useTranslations("workItems.detail");
  if (summary.sessionCount === 0) return null;

  if (compact) {
    const sorted = (sessions ?? []).slice().sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return tb - ta;
    });
    const latest = sorted[0];

    const badge = (
      <Badge
        variant="outline"
        className="gap-1 text-[10px] h-5 font-normal text-muted-foreground max-w-[220px]"
      >
        <Bot className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {formatModelCompact(latest)} {formatCost(summary.totalEstimatedCost)}
        </span>
      </Badge>
    );

    if (sessions && sessions.length > 1) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{badge}</TooltipTrigger>
            <TooltipContent className="p-2 bg-background text-foreground border shadow-md">
              <div className="text-[10px] font-medium mb-1">
                {t("sessions", { count: summary.sessionCount })} · {formatTokens(summary.totalTokens)} tokens ·{" "}
                {formatCost(summary.totalEstimatedCost)}
              </div>
              <div className="space-y-1">
                {sorted.slice(0, 6).map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                    <span className="font-mono truncate max-w-[160px]">{formatModelCompact(s)}</span>
                    <span className="shrink-0">{formatCost(s.estimatedCost)}</span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return (
      badge
    );
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium">{t("aiUsage")}</span>
        <Badge variant="secondary" className="text-[10px] h-4 px-1">
          {t("sessions", { count: summary.sessionCount })}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex items-center gap-1.5">
          <Cpu className="h-3 w-3 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium">{formatTokens(summary.totalTokens)}</p>
            <p className="text-[10px] text-muted-foreground">{t("tokens")}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Coins className="h-3 w-3 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium">{formatCost(summary.totalEstimatedCost)}</p>
            <p className="text-[10px] text-muted-foreground">{t("cost")}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <div>
            <p className="text-xs font-medium">{formatDuration(summary.totalDurationMs)}</p>
            <p className="text-[10px] text-muted-foreground">{t("time")}</p>
          </div>
        </div>
      </div>

      {sessions && sessions.length > 1 && (
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer text-[10px] text-muted-foreground hover:text-foreground px-1 py-1 select-none">
            <span>{t("viewBreakdown")}</span>
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-1 rounded border bg-background">
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
};
