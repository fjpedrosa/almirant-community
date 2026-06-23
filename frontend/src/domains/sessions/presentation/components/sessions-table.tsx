"use client";

import { Bot, Server, TerminalSquare } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AgentJobStatusBadge } from "@/domains/agents/presentation/components/agent-job-status-badge";
import {
  defaultCodingAgentForProvider,
  type CodingAgent,
} from "@/domains/agents/domain/coding-agent-compatibility";
import {
  getModelIcon,
  renderCodingAgentIcon,
} from "@/domains/shared/presentation/utils/provider-icons";
import { useTranslations } from "next-intl";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import type { AgentSessionListItem } from "../../domain/types";
import {
  getDurationMs,
  formatDuration,
  resolveSessionLauncherIdentity,
  resolveSessionDisplayTitle,
  resolveSkillLabel,
  resolveModel,
} from "../../domain/utils";

interface SessionsTableProps {
  sessions: AgentSessionListItem[];
  isLoading: boolean;
  currentTime: number;
  projectColors?: Record<string, string>;
  onOpenSession: (sessionId: string) => void;
}

const getInitials = (name: string | null | undefined): string => {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "U";

  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase() || "U";
};

const CODING_AGENT_LABELS: Record<CodingAgent, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};

const SYSTEM_RUNNER_SKILLS = new Set([
  "dod-review",
  "dod-remediation",
  "runner-fix-dod",
  "integration",
  "release-integration",
]);

const isCodingAgent = (value: unknown): value is CodingAgent =>
  value === "claude-code" || value === "codex" || value === "opencode";

const resolveCodingAgent = (session: AgentSessionListItem): CodingAgent => {
  if (session.codingAgent) return session.codingAgent;

  const configuredCodingAgent = session.config?.codingAgent;
  return isCodingAgent(configuredCodingAgent)
    ? configuredCodingAgent
    : defaultCodingAgentForProvider(session.provider);
};

const normalizeSkillDisplay = (
  skill: string
): {
  label: string;
  rawLabel: string;
  isRunner: boolean;
  runtimeLabel: "Local" | "Runner";
} => {
  const rawLabel = skill.trim() || "-";
  const hasRunnerPrefix = rawLabel.startsWith("runner-");
  const isRunner = hasRunnerPrefix || SYSTEM_RUNNER_SKILLS.has(rawLabel);
  const label = hasRunnerPrefix ? rawLabel.slice("runner-".length) || rawLabel : rawLabel;

  return {
    label,
    rawLabel,
    isRunner,
    runtimeLabel: isRunner ? "Runner" : "Local",
  };
};

const TableSkeleton = () => (
  <>
    {Array.from({ length: 8 }).map((_, index) => (
      <TableRow key={index}>
        <TableCell className="w-[24rem] max-w-[24rem]">
          <Skeleton className="h-10 w-full max-w-[22rem]" />
        </TableCell>
        <TableCell className="w-[14rem] max-w-[14rem]">
          <Skeleton className="h-9 w-36" />
        </TableCell>
        <TableCell className="w-[14rem] max-w-[14rem]">
          <Skeleton className="h-9 w-36" />
        </TableCell>
        <TableCell className="w-[8rem] max-w-[8rem]">
          <Skeleton className="h-6 w-20" />
        </TableCell>
        <TableCell className="w-[10rem] max-w-[10rem]">
          <Skeleton className="h-4 w-28" />
        </TableCell>
      </TableRow>
    ))}
  </>
);

export const SessionsTable: React.FC<SessionsTableProps> = ({
  sessions,
  isLoading,
  currentTime,
  projectColors,
  onOpenSession,
}) => {
  const t = useTranslations("sessions");
  const { formatDateTime } = useFormattedDate();

  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[24rem] max-w-[24rem]">{t("table.task")}</TableHead>
          <TableHead className="w-[14rem] max-w-[14rem]">
            {t("table.project")} / {t("table.skill")}
          </TableHead>
          <TableHead className="w-[14rem] max-w-[14rem]">
            Coding Agent / {t("detail.model")}
          </TableHead>
          <TableHead className="w-[8rem] max-w-[8rem]">{t("table.status")}</TableHead>
          <TableHead className="w-[10rem] max-w-[10rem]">{t("table.startedDuration")}</TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        {isLoading ? (
          <TableSkeleton />
        ) : sessions.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
              {t("table.empty")}
            </TableCell>
          </TableRow>
        ) : (
          sessions.map((session) => {
            const displayTitle = resolveSessionDisplayTitle(session);
            const launcher = resolveSessionLauncherIdentity(session);
            const skillDisplay = normalizeSkillDisplay(resolveSkillLabel(session));
            const SkillIcon = skillDisplay.isRunner ? Server : TerminalSquare;
            const codingAgent = resolveCodingAgent(session);
            const codingAgentLabel = CODING_AGENT_LABELS[codingAgent];
            const model = resolveModel(
              session.model,
              session.config?.model,
              session.config?.fallbackModel
            );
            const projectColor = session.projectId
              ? projectColors?.[session.projectId]
              : undefined;

            return (
              <TableRow
                key={session.id}
                className="cursor-pointer hover:bg-muted/50"
                role="button"
                tabIndex={0}
                onClick={() => onOpenSession(session.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onOpenSession(session.id);
                  }
                }}
              >
                <TableCell className="w-[24rem] max-w-[24rem] whitespace-normal">
                  <div className="space-y-1.5">
                    <p className="truncate font-medium">{displayTitle}</p>
                    {launcher && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Avatar className="size-5 shrink-0">
                          {launcher.kind === "user" && launcher.imageUrl && (
                            <AvatarImage
                              src={launcher.imageUrl}
                              alt={launcher.label}
                            />
                          )}
                          <AvatarFallback
                            className={
                              launcher.kind === "bot"
                                ? "border border-black/10 bg-white text-black dark:border-black/10 dark:bg-white dark:text-black"
                                : "text-[10px]"
                            }
                          >
                            {launcher.kind === "bot" ? (
                              <Bot className="size-3" />
                            ) : (
                              getInitials(launcher.label)
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <span className="truncate">{launcher.label}</span>
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="w-[14rem] max-w-[14rem]">
                  <div className="space-y-1.5">
                    <p
                      className="truncate text-sm font-medium"
                      style={projectColor ? { color: projectColor } : undefined}
                      title={session.projectName ?? "-"}
                    >
                      {session.projectName ?? "-"}
                    </p>
                    {skillDisplay.label === "-" ? (
                      <span className="block text-xs text-muted-foreground">—</span>
                    ) : (
                      <span
                        className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                        title={`${skillDisplay.runtimeLabel}: ${skillDisplay.rawLabel}`}
                      >
                        <SkillIcon className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{skillDisplay.label}</span>
                        <span className="sr-only">{skillDisplay.runtimeLabel}</span>
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="w-[14rem] max-w-[14rem]">
                  <div className="space-y-1.5">
                    <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                      {renderCodingAgentIcon(codingAgent, "size-3.5 shrink-0")}
                      <span className="truncate">{codingAgentLabel}</span>
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {getModelIcon(model, session.provider, "size-3.5 shrink-0")}
                      <span className="truncate" title={model}>
                        {model}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="w-[8rem] max-w-[8rem]">
                  <AgentJobStatusBadge
                    status={session.status}
                    errorType={session.errorType}
                    errorMessage={session.errorMessage}
                  />
                </TableCell>
                <TableCell className="w-[10rem] max-w-[10rem]">
                  <div className="space-y-0.5">
                    <p className="text-sm text-muted-foreground">
                      {formatDateTime(session.startedAt ?? session.createdAt)}
                    </p>
                    <p className="font-mono text-sm">
                      {formatDuration(getDurationMs(session, currentTime))}
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
};
