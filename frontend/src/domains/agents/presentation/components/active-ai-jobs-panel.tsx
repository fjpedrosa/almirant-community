import { Bot, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getProviderIconComponent,
  getProviderShortLabel,
} from "@/domains/shared/presentation/utils/provider-icons";
import { useConfirmDialog } from "@/domains/shared/application/hooks/use-confirm-dialog";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { cn } from "@/lib/utils";
import type { ActiveAiJobsPanelProps, ActiveAiJobItem, AgentJobStatus } from "../../domain/types";

const formatElapsed = (startedAt: Date | null, now: number): string => {
  if (!startedAt) return "-";
  const start = typeof startedAt === "string" ? new Date(startedAt as string) : startedAt;
  const elapsedMs = now - start.getTime();
  if (elapsedMs < 0) return "-";
  const totalSeconds = Math.floor(elapsedMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    const secs = totalSeconds % 60;
    return `${minutes}m ${secs}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

const statusBadgeVariant = (
  status: AgentJobStatus
): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "running":
      return "default";
    case "finalizing":
      return "secondary";
    case "queued":
      return "secondary";
    case "waiting_for_input":
      return "outline";
    case "paused":
      return "secondary";
    default:
      return "secondary";
  }
};

const ProviderBadge: React.FC<{ provider: string }> = ({ provider }) => {
  const Icon = getProviderIconComponent(provider);
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3 w-3" />
      <span className="text-[10px] text-muted-foreground">
        {getProviderShortLabel(provider)}
      </span>
    </span>
  );
};

const JobRow: React.FC<{
  job: ActiveAiJobItem;
  currentTime: number;
  onCancel: (jobId: string) => void;
  isCancelling: boolean;
  cancelLabel: string;
  confirmTitle: string;
  confirmDescription: string;
}> = ({ job, currentTime, onCancel, isCancelling, cancelLabel, confirmTitle, confirmDescription }) => {
  const tStatus = useTranslations("agents.status");
  const { confirm, ...confirmDialogProps } = useConfirmDialog();

  const handleCancel = async () => {
    const confirmed = await confirm({
      title: confirmTitle,
      description: confirmDescription,
      confirmLabel: cancelLabel,
      variant: "destructive",
    });
    if (confirmed) {
      onCancel(job.jobId);
    }
  };

  return (
    <div className="flex items-center gap-2 py-2 px-1 border-b last:border-b-0">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate" title={job.workItemTitle}>
          {job.workItemTitle}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <ProviderBadge provider={job.provider} />
          <Badge
            variant={statusBadgeVariant(job.status)}
            className={cn(
              "text-[10px] px-1.5 py-0",
              job.status === "running" && "animate-pulse",
              job.status === "paused" && "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300"
            )}
          >
            {job.status === "paused" ? "Paused" : tStatus(job.status)}
          </Badge>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] tabular-nums text-muted-foreground min-w-[40px] text-right">
          {job.status === "running" || job.status === "finalizing"
            ? formatElapsed(job.startedAt, currentTime)
            : "-"}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-destructive"
              onClick={handleCancel}
              disabled={isCancelling}
              aria-label={cancelLabel}
            >
              <X className="h-3 w-3" />
              <span className="sr-only">{cancelLabel}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{cancelLabel}</TooltipContent>
        </Tooltip>
      </div>

      <ConfirmDialog
        isOpen={confirmDialogProps.isOpen}
        options={confirmDialogProps.options}
        onConfirm={confirmDialogProps.handleConfirm}
        onCancel={confirmDialogProps.handleCancel}
      />
    </div>
  );
};

export const ActiveAiJobsPanel: React.FC<ActiveAiJobsPanelProps> = ({
  jobs,
  onCancelJob,
  isCancelling,
  currentTime,
}) => {
  const t = useTranslations("agents.activity");

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <Bot className="h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-xs text-muted-foreground">{t("noActiveJobs")}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h4 className="text-sm font-semibold mb-2">{t("panelTitle")}</h4>
      <ScrollArea className="max-h-[280px]">
        <div className="divide-y">
          {jobs.map((job) => (
            <JobRow
              key={job.jobId}
              job={job}
              currentTime={currentTime}
              onCancel={onCancelJob}
              isCancelling={isCancelling}
              cancelLabel={t("cancelJob")}
              confirmTitle={t("cancelJob")}
              confirmDescription={t("cancelConfirm")}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
