import { useTranslations } from "next-intl";
import { BrainCircuit, RefreshCw, Unplug } from "lucide-react";
import { AnthropicIcon } from "@/components/icons/anthropic-icon";
import { OpenAIIcon } from "@/components/icons/openai-icon";
import { ZAIIcon } from "@/components/icons/zai-icon";
import { XAIIcon } from "@/components/icons/xai-icon";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { WorkspaceSelector } from "./workspace-selector";
import type { ProviderUsagePanelSheetProps } from "../../domain/types";

const GoogleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    role="img"
    aria-label="Google"
  >
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

const PROVIDER_ICONS: Record<string, React.FC<{ className?: string }>> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  google: GoogleIcon,
  zai: ZAIIcon,
  xai: XAIIcon,
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  zai: "z.ai",
  xai: "xAI",
};

export const ProviderUsagePanelSheet: React.FC<
  ProviderUsagePanelSheetProps & {
    renderConnectionRow: (connectionId: string, provider: string) => React.ReactNode;
  }
> = ({
  open,
  onOpenChange,
  selectedWorkspaceId,
  workspaceOptions,
  onWorkspaceChange,
  providerGroups,
  isLoading,
  onRefreshAll,
  isRefreshingAll,
  renderConnectionRow,
}) => {
  const t = useTranslations("providerUsagePanel");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[400px] flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base">{t("title")}</SheetTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={onRefreshAll}
                    disabled={isRefreshingAll || isLoading}
                    aria-label={t("refreshAll")}
                  >
                    <RefreshCw
                      className={cn("h-4 w-4", isRefreshingAll && "animate-spin")}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{t("refreshAll")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <SheetDescription className="sr-only">{t("title")}</SheetDescription>
        </SheetHeader>

        {/* Workspace selector */}
        <div className="px-4 pt-2 pb-3 border-b">
          <WorkspaceSelector
            value={selectedWorkspaceId}
            options={workspaceOptions}
            isLoading={false}
            isSwitching={false}
            onChange={onWorkspaceChange}
          />
        </div>

        {/* Content */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-5">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2].map((i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-20 w-full rounded-lg" />
                  </div>
                ))}
              </div>
            ) : providerGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Unplug className="h-8 w-8 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-medium text-muted-foreground">
                  {t("noProviders")}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  {t("noProvidersHint")}
                </p>
              </div>
            ) : (
              providerGroups.map((group) => (
                <div key={group.provider} className="space-y-2">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {(() => {
                      const Icon = PROVIDER_ICONS[group.provider] ?? BrainCircuit;
                      return <Icon className="h-4 w-4" />;
                    })()}
                    {PROVIDER_LABELS[group.provider] ?? group.provider}
                  </h3>
                  <div className="space-y-2">
                    {group.connections.map((conn) => (
                      <div key={conn.id}>
                        {renderConnectionRow(conn.id, conn.provider)}
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
