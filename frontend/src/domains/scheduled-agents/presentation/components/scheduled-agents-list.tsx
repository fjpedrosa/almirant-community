import { MoreHorizontal, Pencil, Trash2, Clock, Webhook, Play, Loader2, Sparkles, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getModelIcon,
  renderCodingAgentIcon,
} from "@/domains/shared/presentation/utils/provider-icons";
import {
  defaultCodingAgentForProvider,
  type CodingAgent,
} from "@/domains/agents/domain/coding-agent-compatibility";
import type {
  ScheduledAgentsListProps,
  ScheduledAgentConfig,
} from "../../domain/types";
import {
  isTimeWindowConfig,
  isCronConfig,
  DAY_OF_WEEK_OPTIONS,
} from "../../domain/types";
import { findCronPreset } from "../../domain/cron-presets";
import { API_BASE } from "@/lib/api/client";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";

const SKELETON_ROWS = 3;

const CODING_AGENT_LABELS: Record<CodingAgent, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

const isCodingAgent = (value: unknown): value is CodingAgent =>
  value === "claude-code" || value === "codex" || value === "opencode";

const resolveCodingAgent = (item: ScheduledAgentConfig): CodingAgent =>
  isCodingAgent(item.codingAgent)
    ? item.codingAgent
    : defaultCodingAgentForProvider(item.provider);

const SkeletonRow = () => (
  <TableRow>
    {Array.from({ length: 7 }).map((_, i) => (
      <TableCell key={i}>
        <Skeleton className="h-9 w-full" />
      </TableCell>
    ))}
  </TableRow>
);

/** Returns a human-readable description of the cron expression */
const formatCronHuman = (expression: string): string => {
  const preset = findCronPreset(expression);
  if (preset) {
    if (preset.endsWith("m")) return `Every ${preset.replace("m", " min")}`;
    if (preset.endsWith("h")) {
      const hours = preset.replace("h", "");
      return hours === "1" ? "Every hour" : `Every ${hours} hours`;
    }
    return preset;
  }

  // Parse common cron patterns when no preset matches
  const parts = expression.trim().split(/\s+/);
  if (parts.length === 5) {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const isWildcard = (v: string) => v === "*";
    const allWild = isWildcard(hour) && isWildcard(dayOfMonth) && isWildcard(month) && isWildcard(dayOfWeek);

    if (minute.startsWith("*/") && allWild) {
      return `Every ${minute.slice(2)} min`;
    }
    if (minute === "0" && hour.startsWith("*/") && isWildcard(dayOfMonth) && isWildcard(month) && isWildcard(dayOfWeek)) {
      const h = hour.slice(2);
      return h === "1" ? "Every hour" : `Every ${h} hours`;
    }
    if (/^\d+$/.test(minute) && allWild) {
      return `Every hour at :${minute.padStart(2, "0")}`;
    }
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && isWildcard(dayOfMonth) && isWildcard(month) && isWildcard(dayOfWeek)) {
      return `Daily at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    }
  }

  return expression;
};

const formatScheduleDetail = (config: ScheduledAgentConfig): string => {
  if (config.scheduleType === "manual" || !config.scheduleConfig) {
    return "Run on demand";
  }
  if (isTimeWindowConfig(config.scheduleConfig)) {
    const { startHour, daysOfWeek } = config.scheduleConfig;
    const days = daysOfWeek
      .map((d) => DAY_OF_WEEK_OPTIONS.find((opt) => opt.value === d)?.label.slice(0, 3))
      .filter(Boolean)
      .join(", ");
    const startLabel = `${startHour.toString().padStart(2, "0")}:00`;
    return days ? `${startLabel} (${days})` : startLabel;
  }
  if (isCronConfig(config.scheduleConfig)) {
    return formatCronHuman(config.scheduleConfig.expression);
  }
  return "Unknown";
};

const formatLastRun = (lastRunAt: string | null): string => {
  if (!lastRunAt) return "Never";
  try {
    return new Date(lastRunAt).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Unknown";
  }
};

const getPublicWebhookRoot = (): string => {
  const base = API_BASE.replace(/\/$/, "");
  const root = base.endsWith("/api") ? base.slice(0, -"/api".length) : base;
  if (root) return root;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
};

const getWebhookUrl = (item: ScheduledAgentConfig): string | null => {
  if (item.trigger !== "webhook" || !item.webhookToken) return null;
  return `${getPublicWebhookRoot()}/webhooks/agents/${item.id}?token=${encodeURIComponent(item.webhookToken)}`;
};

const getProjectScopeLabel = (item: ScheduledAgentConfig): string => {
  const scopedProjectIds = item.targetConfig?.projectIds ?? [];
  if (scopedProjectIds.length > 1) return `${scopedProjectIds.length} projects`;
  if (scopedProjectIds.length === 1) return "1 project";
  const backlogStyleProjectCount =
    item.targetConfig?.backlogDrain?.projects?.length ??
    item.targetConfig?.dodRemediation?.projects?.length ??
    0;
  if (backlogStyleProjectCount > 1) return `${backlogStyleProjectCount} projects`;
  if (backlogStyleProjectCount === 1) return "1 project";
  if (item.projectName) return item.projectName;
  if (
    item.targetConfig?.dodReview?.enabled === true ||
    item.targetConfig?.dodRemediation?.enabled === true ||
    item.targetConfig?.releaseIntegration?.enabled === true
  ) {
    return "All projects";
  }
  return "No project";
};

const copyWebhookEndpoint = (url: string) => {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(url).then(() => {
    showToast.success("Webhook endpoint copied");
  });
};

interface ScheduledAgentRowProps {
  item: ScheduledAgentConfig;
  isTriggering: boolean;
  projectColor: string | undefined;
  onToggle: (item: ScheduledAgentConfig) => void;
  onEdit: (item: ScheduledAgentConfig) => void;
  onDelete: (item: ScheduledAgentConfig) => void;
  onTrigger: (item: ScheduledAgentConfig) => void;
}

const ScheduledAgentRow = ({
  item,
  isTriggering,
  projectColor,
  onToggle,
  onEdit,
  onDelete,
  onTrigger,
}: ScheduledAgentRowProps) => {
  const codingAgent = resolveCodingAgent(item);
  const codingAgentLabel = CODING_AGENT_LABELS[codingAgent];
  const model = item.aiModel ?? "—";
  const isWebhook = item.trigger === "webhook";
  // A non-webhook agent without a real cadence (manual / no schedule config) is
  // "run on demand" — it is NOT "Scheduled". Deriving the badge from `trigger`
  // alone mislabels these as Scheduled and contradicts the "Run on demand"
  // detail below.
  const isManual =
    !isWebhook && (item.scheduleType === "manual" || !item.scheduleConfig);
  const webhookUrl = getWebhookUrl(item);
  const projectScopeLabel = getProjectScopeLabel(item);
  const hasDirectProject = Boolean(item.projectName);

  return (
    <TableRow>
      {/* Name + timezone */}
      <TableCell className="w-[15rem] max-w-[15rem]">
        <div className="space-y-1.5">
          <p className="truncate font-medium">{item.name}</p>
          <p className="text-xs text-muted-foreground">{item.timezone}</p>
        </div>
      </TableCell>

      {/* Project / Skill */}
      <TableCell className="w-[10rem] max-w-[10rem]">
        <div className="space-y-1.5">
          <p
            className="truncate text-sm font-medium"
            style={projectColor && hasDirectProject ? { color: projectColor } : undefined}
            title={projectScopeLabel}
          >
            {hasDirectProject ? item.projectName : <span className="text-muted-foreground italic">{projectScopeLabel}</span>}
          </p>
          {item.skillName ? (
            <span
              className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
              title={`Skill: ${item.skillName}`}
            >
              <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{item.skillName}</span>
            </span>
          ) : (
            <span className="block text-xs text-muted-foreground">—</span>
          )}
        </div>
      </TableCell>

      {/* Coding agent / Model */}
      <TableCell className="w-[11rem] max-w-[11rem]">
        <div className="space-y-1.5">
          <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            {renderCodingAgentIcon(codingAgent, "size-3.5 shrink-0")}
            <span className="truncate">{codingAgentLabel}</span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {getModelIcon(model, item.provider, "size-3.5 shrink-0")}
            <span className="truncate" title={model}>
              {model}
            </span>
          </div>
        </div>
      </TableCell>

      {/* Trigger */}
      <TableCell className="w-[15rem] max-w-[15rem]">
        <div className="space-y-1.5">
          <Badge variant={isWebhook ? "default" : "secondary"} className="gap-1.5">
            {isWebhook ? (
              <Webhook className="h-3 w-3" />
            ) : isManual ? (
              <Play className="h-3 w-3" />
            ) : (
              <Clock className="h-3 w-3" />
            )}
            {isWebhook ? "Webhook" : isManual ? "Manual" : "Scheduled"}
          </Badge>
          {webhookUrl ? (
            <button
              type="button"
              className="flex max-w-full items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              aria-label="Copy webhook endpoint"
              title={`Copy webhook endpoint: ${webhookUrl}`}
              onClick={() => copyWebhookEndpoint(webhookUrl)}
            >
              <Copy className="size-3 shrink-0" />
              <span className="truncate">{webhookUrl}</span>
            </button>
          ) : (
            <p className="truncate text-xs text-muted-foreground">
              {isWebhook ? "Save to generate token" : formatScheduleDetail(item)}
            </p>
          )}
        </div>
      </TableCell>

      {/* Last run */}
      <TableCell className="w-[8rem] text-sm text-muted-foreground">
        {formatLastRun(item.lastRunAt)}
      </TableCell>

      {/* Enabled */}
      <TableCell className="w-20">
        {/* Manual agents cannot be enabled until they have a schedule — surface
            that instead of a silently-dead toggle. */}
        <span
          title={
            isManual
              ? "Add a Time Window or Cron schedule to enable this agent"
              : undefined
          }
          className="inline-flex"
        >
          <Switch
            checked={item.enabled}
            onCheckedChange={() => onToggle(item)}
            disabled={isWebhook || isManual}
            aria-label={`Toggle ${item.name}`}
          />
        </span>
      </TableCell>

      {/* Actions */}
      <TableCell className="w-12 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onTrigger(item)} disabled={isTriggering}>
              {isTriggering ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run Now
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(item)}>
              <Pencil className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(item)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};

export const ScheduledAgentsList = ({
  items,
  isLoading,
  triggeringId,
  projectColors,
  onToggle,
  onEdit,
  onDelete,
  onTrigger,
}: ScheduledAgentsListProps) => {
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[1056px] table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[15rem]">Name</TableHead>
            <TableHead className="w-[10rem]">Project / Skill</TableHead>
            <TableHead className="w-[11rem]">Coding Agent / Model</TableHead>
            <TableHead className="w-[15rem]">Trigger</TableHead>
            <TableHead className="w-[8rem]">Last Run</TableHead>
            <TableHead className="w-20">Enabled</TableHead>
            <TableHead className="w-12 text-right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <SkeletonRow key={i} />
            ))
          ) : items.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="h-32 text-center text-muted-foreground"
              >
                No scheduled agents configured. Create one to automate your
                workflows.
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <ScheduledAgentRow
                key={item.id}
                item={item}
                isTriggering={triggeringId === item.id}
                projectColor={item.projectId ? projectColors?.[item.projectId] : undefined}
                onToggle={onToggle}
                onEdit={onEdit}
                onDelete={onDelete}
                onTrigger={onTrigger}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};
