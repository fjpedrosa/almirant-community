"use client";

import { useEffect, useRef, useState } from 'react';
import { SessionTranscript } from './session-transcript';
import { SessionEventTimeline } from './session-event-timeline';
import { SessionInteractionPanel } from './session-interaction-panel';
import { SessionResourceTimeline } from './session-resource-timeline';
import { SessionResourceSidebar } from './session-resource-sidebar';
import { Bot, Check, ChevronsDownUp, ChevronsUpDown, Copy, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsMobile } from '@/lib/hooks';
import type {
  ConversationMessage,
  QuickFeedbackData,
} from '@/domains/shared/domain/conversation-types';
import {
  resolveModel,
  resolveSkill,
  formatDuration,
  resolveSessionLauncherIdentity,
} from '../../domain/utils';
import {
  getModelIcon,
  renderCodingAgentIcon,
} from '@/domains/shared/presentation/utils/provider-icons';
import type { CodingAgent } from '@/domains/agents/domain/coding-agent-compatibility';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type {
  AgentSessionDetail,
  TimelinePhase,
  TranscriptSegment,
} from '../../domain/types';
import type { AgentLogChunk } from '@/domains/shared/domain/types';
import type { StreamingBlock } from '@/domains/shared/domain/streaming-block-types';
import type {
  ResourceTimeline,
  WorkerInteraction,
} from '@/domains/agents/domain/types';
import type { ResolvedTaskId } from '../../application/hooks/use-task-id-resolution';

interface SessionDetailViewProps {
  detail: AgentSessionDetail;
  chunks: AgentLogChunk[];
  isLive: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number | null;
  messages: ConversationMessage[];
  transcript: string;
  segments?: TranscriptSegment[];
  streamingBlocks?: StreamingBlock[];
  isStreaming: boolean;
  isTranscriptLoading: boolean;
  phases: TimelinePhase[];
  resourceTimeline?: ResourceTimeline | null;
  isResourceTimelineLoading?: boolean;
  isActive: boolean;
  isCancelling: boolean;
  elapsedTime: string;
  onStop: () => void;
  formatDateTime?: (date: string | Date) => string;
  t?: (key: string) => string;
  pendingInteraction?: WorkerInteraction | null;
  answerText?: string;
  onAnswerChange?: (text: string) => void;
  onRespond?: () => void;
  onRespondWithOption?: (option: string) => void;
  isResponding?: boolean;
  taskIdMap?: Map<string, ResolvedTaskId>;
  allThinkingCollapsed?: boolean;
  hasThinkingBlocks?: boolean;
  onToggleAllThinking?: () => void;
  isThinkingOpen?: (index: number) => boolean;
  onThinkingToggle?: (index: number) => void;
  hasBackgroundAgentsWaiting?: boolean;
  onFeedback?: (messageId: string, data: QuickFeedbackData) => void;
}

const formatShortId = (id: string | null | undefined): string | null => {
  if (!id) return null;
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
};

const CopyableIdValue: React.FC<{
  value: string | null | undefined;
  displayValue: string | null;
  label: string;
}> = ({ value, displayValue, label }) => {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (!value) return;

    await navigator.clipboard.writeText(value);
    setCopied(true);

    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
    }
    resetTimeoutRef.current = setTimeout(() => setCopied(false), 1400);
  };

  if (!value || !displayValue) {
    return <span className="text-muted-foreground">—</span>;
  }

  const Icon = copied ? Check : Copy;

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="truncate font-mono text-xs text-foreground" title={value}>
        {displayValue}
      </span>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        title={copied ? "Copied" : `Copy ${label}`}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={handleCopy}
      >
        <Icon className="size-3.5" />
      </button>
    </span>
  );
};

export const SessionDetailView: React.FC<SessionDetailViewProps> = ({
  detail,
  messages,
  transcript,
  segments,
  streamingBlocks,
  isStreaming,
  isTranscriptLoading,
  phases,
  resourceTimeline,
  isResourceTimelineLoading,
  isActive,
  isCancelling,
  onStop,
  currentTime,
  duration,
  pendingInteraction,
  answerText,
  onAnswerChange,
  onRespond,
  onRespondWithOption,
  isResponding,
  taskIdMap,
  allThinkingCollapsed,
  hasThinkingBlocks,
  onToggleAllThinking,
  isThinkingOpen,
  onThinkingToggle,
  hasBackgroundAgentsWaiting,
  onFeedback,
  formatDateTime,
}) => {
  const job = detail.job;
  const model = resolveModel(
    job.model,
    job.config?.model,
    job.config?.fallbackModel,
  );
  const skill = resolveSkill(job.jobType, job.config?.skillName);
  const launcher = resolveSessionLauncherIdentity(job);
  const codingAgent =
    (job.codingAgent as CodingAgent | null | undefined) ??
    (job.config?.codingAgent as CodingAgent | null | undefined) ??
    null;
  const processingStartedAt = job.startedAt
    ? new Date(job.startedAt).getTime()
    : undefined;
  const transcriptTimeZone =
    typeof job.config?.timezone === "string" && job.config.timezone.trim()
      ? job.config.timezone
      : undefined;

  const formatTime = formatDateTime ?? ((d: string | Date) =>
    new Date(d).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  );

  const jobIdShort = formatShortId(job.id);
  const sessionIdShort = formatShortId(job.sessionId);

  const codingAgentLabel =
    codingAgent === 'claude-code'
      ? 'Claude Code'
      : codingAgent === 'codex'
        ? 'Codex'
        : codingAgent === 'opencode'
          ? 'OpenCode'
          : null;

  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {/* Compact header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/30 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-xs text-muted-foreground">
              {skill ?? 'Session'}
            </p>
            <p className="truncate text-sm font-medium tabular-nums">
              {model ?? '—'} · {formatDuration(duration)}
            </p>
          </div>
          {isActive && (
            <Button
              variant="destructive"
              size="sm"
              className="h-8 shrink-0 px-3 text-xs"
              disabled={isCancelling}
              onClick={onStop}
            >
              <Square className="mr-1 h-3 w-3" />
              {isCancelling ? 'Stopping…' : 'Stop'}
            </Button>
          )}
        </div>

        {/* Interaction panel (above tabs when pending) */}
        {pendingInteraction &&
          onAnswerChange &&
          onRespond &&
          onRespondWithOption && (
            <SessionInteractionPanel
              interaction={pendingInteraction}
              answerText={answerText ?? ''}
              onAnswerChange={onAnswerChange}
              onRespond={onRespond}
              onRespondWithOption={onRespondWithOption}
              isResponding={isResponding ?? false}
              currentTime={currentTime}
            />
          )}

        <Tabs
          defaultValue="transcript"
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList className="sticky top-0 z-10 grid w-full shrink-0 grid-cols-3 rounded-none border-b bg-background p-0">
            <TabsTrigger value="info" className="rounded-none">
              Info
            </TabsTrigger>
            <TabsTrigger value="resources" className="rounded-none">
              Resources
            </TabsTrigger>
            <TabsTrigger value="transcript" className="rounded-none">
              Transcript
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="info"
            className="min-h-0 flex-1 overflow-y-auto p-4 data-[state=inactive]:hidden"
          >
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Coding Agent</dt>
                <dd className="flex items-center gap-1.5 text-sm font-medium">
                  {codingAgent && codingAgentLabel ? (
                    <>
                      {renderCodingAgentIcon(codingAgent, 'size-3.5')}
                      {codingAgentLabel}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Model</dt>
                <dd className="flex items-center gap-1.5 text-sm font-medium">
                  {getModelIcon(model, job.provider, 'size-3.5')}
                  {model ?? <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Skill</dt>
                <dd className="text-sm font-medium">
                  {skill ?? <span className="text-muted-foreground">—</span>}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Project</dt>
                <dd className="text-sm font-medium">
                  {detail.project?.name ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Author</dt>
                <dd className="flex items-center gap-1.5 text-sm font-medium">
                  {launcher ? (
                    <>
                      <Avatar className="size-4">
                        {launcher.kind === 'user' && launcher.imageUrl && (
                          <AvatarImage
                            src={launcher.imageUrl}
                            alt={launcher.label}
                          />
                        )}
                        <AvatarFallback
                          className={
                            launcher.kind === 'bot'
                              ? 'border border-black/10 bg-white text-black dark:border-black/10 dark:bg-white dark:text-black'
                              : 'text-[9px] font-medium text-muted-foreground'
                          }
                        >
                          {launcher.kind === 'bot' ? (
                            <Bot className="size-2.5" />
                          ) : (
                            launcher.label.charAt(0).toUpperCase()
                          )}
                        </AvatarFallback>
                      </Avatar>
                      {launcher.label}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Duration</dt>
                <dd className="text-sm font-medium tabular-nums">
                  {formatDuration(duration)}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Started</dt>
                <dd className="text-sm font-medium tabular-nums">
                  {formatTime(job.createdAt)}
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Job ID</dt>
                <dd>
                  <CopyableIdValue
                    value={job.id}
                    displayValue={jobIdShort}
                    label="Job ID"
                  />
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">Session ID</dt>
                <dd>
                  <CopyableIdValue
                    value={job.sessionId}
                    displayValue={sessionIdShort}
                    label="Session ID"
                  />
                </dd>
              </div>
            </dl>
          </TabsContent>

          <TabsContent
            value="resources"
            className="min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden"
          >
            <SessionResourceTimeline
              timeline={resourceTimeline}
              isLoading={isResourceTimelineLoading}
            />
          </TabsContent>

          <TabsContent
            value="transcript"
            className="flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
          >
            {hasThinkingBlocks && onToggleAllThinking && (
              <div className="flex items-center border-b px-4 py-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs text-muted-foreground"
                  onClick={onToggleAllThinking}
                >
                  {allThinkingCollapsed ? (
                    <>
                      <ChevronsUpDown className="h-3.5 w-3.5" />
                      <span>Expand thinking</span>
                    </>
                  ) : (
                    <>
                      <ChevronsDownUp className="h-3.5 w-3.5" />
                      <span>Collapse thinking</span>
                    </>
                  )}
                </Button>
              </div>
            )}
            <SessionTranscript
              messages={messages}
              timeZone={transcriptTimeZone}
              transcript={transcript}
              segments={segments}
              streamingBlocks={streamingBlocks}
              isStreaming={isStreaming}
              isLoading={isTranscriptLoading}
              className="min-h-0 flex-1"
              taskIdMap={taskIdMap}
              isThinkingOpen={isThinkingOpen}
              onThinkingToggle={onThinkingToggle}
              hasBackgroundAgentsWaiting={hasBackgroundAgentsWaiting}
              onFeedback={onFeedback}
              processingStartedAt={
                typeof processingStartedAt === 'number' &&
                !Number.isNaN(processingStartedAt)
                  ? processingStartedAt
                  : undefined
              }
            />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* Header: dense metadata row */}
      <div className="flex shrink-0 items-center gap-4 border-b bg-muted/30 pl-10 pr-8 py-5">
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6 2xl:grid-cols-9 items-center">
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Coding Agent</dt>
            <dd className="flex items-center gap-1.5 text-sm font-medium">
              {codingAgent && codingAgentLabel ? (
                <>
                  {renderCodingAgentIcon(codingAgent, 'size-3.5')}
                  {codingAgentLabel}
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Model</dt>
            <dd className="flex items-center gap-1.5 text-sm font-medium">
              {getModelIcon(model, job.provider, 'size-3.5')}
              {model ?? <span className="text-muted-foreground">—</span>}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Skill</dt>
            <dd className="text-sm font-medium">
              {skill ?? <span className="text-muted-foreground">—</span>}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Project</dt>
            <dd className="text-sm font-medium">
              {detail.project?.name ?? (
                <span className="text-muted-foreground">—</span>
              )}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Author</dt>
            <dd className="flex items-center gap-1.5 text-sm font-medium">
              {launcher ? (
                <>
                  <Avatar className="size-4">
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
                          : "text-[9px] font-medium text-muted-foreground"
                      }
                    >
                      {launcher.kind === "bot" ? (
                        <Bot className="size-2.5" />
                      ) : (
                        launcher.label.charAt(0).toUpperCase()
                      )}
                    </AvatarFallback>
                  </Avatar>
                  {launcher.label}
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Duration</dt>
            <dd className="text-sm font-medium tabular-nums">
              {formatDuration(duration)}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Started</dt>
            <dd className="text-sm font-medium tabular-nums">
              {formatTime(job.createdAt)}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Job ID</dt>
            <dd>
              <CopyableIdValue
                value={job.id}
                displayValue={jobIdShort}
                label="Job ID"
              />
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">Session ID</dt>
            <dd>
              <CopyableIdValue
                value={job.sessionId}
                displayValue={sessionIdShort}
                label="Session ID"
              />
            </dd>
          </div>
        </dl>
        {isActive && (
          <Button
            variant="destructive"
            size="sm"
            className="ml-auto h-7 shrink-0 px-3 text-xs"
            disabled={isCancelling}
            onClick={onStop}
          >
            <Square className="mr-1 h-3 w-3" />
            {isCancelling ? 'Stopping…' : 'Stop'}
          </Button>
        )}
      </div>

      {/* Interaction panel (above content when pending) */}
      {pendingInteraction &&
        onAnswerChange &&
        onRespond &&
        onRespondWithOption && (
          <SessionInteractionPanel
            interaction={pendingInteraction}
            answerText={answerText ?? ''}
            onAnswerChange={onAnswerChange}
            onRespond={onRespond}
            onRespondWithOption={onRespondWithOption}
            isResponding={isResponding ?? false}
            currentTime={currentTime}
          />
        )}

      {/* Main area: events left + transcript center + resources right */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Events timeline sidebar */}
        <div className="hidden w-32 shrink-0 overflow-y-auto px-3 pt-8 pb-4 lg:flex lg:justify-center">
          <SessionEventTimeline phases={phases} />
        </div>

        {/* Transcript */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {hasThinkingBlocks && onToggleAllThinking && (
            <div className="flex items-center border-b px-4 py-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground"
                onClick={onToggleAllThinking}
              >
                {allThinkingCollapsed ? (
                  <>
                    <ChevronsUpDown className="h-3.5 w-3.5" />
                    <span>Expand thinking</span>
                  </>
                ) : (
                  <>
                    <ChevronsDownUp className="h-3.5 w-3.5" />
                    <span>Collapse thinking</span>
                  </>
                )}
              </Button>
            </div>
          )}
          <SessionTranscript
            messages={messages}
            timeZone={transcriptTimeZone}
            transcript={transcript}
            segments={segments}
            streamingBlocks={streamingBlocks}
            isStreaming={isStreaming}
            isLoading={isTranscriptLoading}
            className="min-h-0 flex-1"
            taskIdMap={taskIdMap}
            isThinkingOpen={isThinkingOpen}
            onThinkingToggle={onThinkingToggle}
            hasBackgroundAgentsWaiting={hasBackgroundAgentsWaiting}
            onFeedback={onFeedback}
            processingStartedAt={
              typeof processingStartedAt === 'number' &&
              !Number.isNaN(processingStartedAt)
                ? processingStartedAt
                : undefined
            }
          />
        </div>

        {/* Resources sidebar */}
        <aside className="hidden w-80 shrink-0 overflow-y-auto bg-muted/20 p-3 lg:block">
          <SessionResourceSidebar
            timeline={resourceTimeline}
            isLoading={isResourceTimelineLoading}
          />
        </aside>
      </div>
    </div>
  );
};
