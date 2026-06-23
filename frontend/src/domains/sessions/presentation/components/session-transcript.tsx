import { useMemo, useCallback, type ReactNode } from "react";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ConversationTimeline } from "@/domains/shared/presentation/components/conversation-timeline";
import { TASK_ID_REGEX } from "../../domain/task-id-linker";
import { TaskIdLink } from "./task-id-link";
import {
  ThinkingBlock,
  StreamingActivityIndicator,
  BackgroundAgentsWaiting,
} from "@/domains/shared/presentation/components/streaming-blocks";
import type { ResolvedTaskId } from "../../application/hooks/use-task-id-resolution";
import type { TranscriptSegment } from "../../domain/types";
import type { ConversationMessage, QuickFeedbackData } from "@/domains/shared/domain/conversation-types";
import type { StreamingBlock } from "@/domains/shared/domain/streaming-block-types";

interface SessionTranscriptProps {
  messages?: ConversationMessage[];
  timeZone?: string;
  transcript: string;
  isStreaming: boolean;
  isLoading: boolean;
  segments?: TranscriptSegment[];
  streamingBlocks?: StreamingBlock[];
  scrollAreaRef?: React.RefObject<HTMLDivElement | null>;
  className?: string;
  taskIdMap?: Map<string, ResolvedTaskId>;
  isThinkingOpen?: (index: number) => boolean;
  onThinkingToggle?: (index: number) => void;
  hasBackgroundAgentsWaiting?: boolean;
  processingStartedAt?: number;
  onFeedback?: (messageId: string, data: QuickFeedbackData) => void;
}

export const SessionTranscript: React.FC<SessionTranscriptProps> = ({
  messages,
  timeZone,
  transcript,
  isStreaming,
  isLoading,
  segments,
  streamingBlocks,
  scrollAreaRef,
  className,
  taskIdMap,
  isThinkingOpen,
  onThinkingToggle,
  hasBackgroundAgentsWaiting = false,
  processingStartedAt,
  onFeedback,
}) => {
  const taskIdComponents = useMemo(() => {
    if (!taskIdMap || taskIdMap.size === 0) return undefined;

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      p: ({ children, ...rest }: any) => {
        const processed = processChildren(children, taskIdMap);
        return <p {...rest}>{processed}</p>;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      li: ({ children, ...rest }: any) => {
        const processed = processChildren(children, taskIdMap);
        return <li {...rest}>{processed}</li>;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      td: ({ children, ...rest }: any) => {
        const processed = processChildren(children, taskIdMap);
        return <td {...rest}>{processed}</td>;
      },
    };
  }, [taskIdMap]);

  const conversationMessages = messages ?? [];
  const hasMessages = conversationMessages.length > 0;
  const hasStreamingBlocks = (streamingBlocks?.length ?? 0) > 0;
  const hasSegments = (segments?.length ?? 0) > 0;
  const hasRenderableContent =
    hasMessages ||
    hasStreamingBlocks ||
    hasSegments ||
    transcript.trim().length > 0;

  const runningBackgroundAgents = useMemo(() => {
    if (!streamingBlocks) return [];
    return streamingBlocks
      .filter(
        (block): block is StreamingBlock & { type: "subagent" } =>
          block.type === "subagent" &&
          block.isBackground &&
          block.status === "running",
      )
      .map((block) => ({
        subagentId: block.subagentId,
        description: block.description,
        subagentType: block.subagentType,
        status: block.status,
      }));
  }, [streamingBlocks]);
  const runningBackgroundAgentCount = runningBackgroundAgents.length;
  const hasBackgroundAgentBlocks = useMemo(() => {
    if (!streamingBlocks) return false;
    return streamingBlocks.some(
      (block) => block.type === "subagent" && block.isBackground,
    );
  }, [streamingBlocks]);
  const showBackgroundAgentsWaiting =
    isStreaming &&
    (
      runningBackgroundAgentCount > 0 ||
      (hasBackgroundAgentsWaiting && !hasBackgroundAgentBlocks)
    );

  const getThinkingIndex = useCallback((thinkingId: string): number | null => {
    const parseIndex = (rawIndex: string | undefined): number | null => {
      if (rawIndex == null) return null;
      const parsed = Number.parseInt(rawIndex, 10);
      return Number.isNaN(parsed) ? null : parsed;
    };

    const streamPrefix = "stream-thinking-";
    if (thinkingId.startsWith(streamPrefix)) {
      return parseIndex(thinkingId.slice(streamPrefix.length));
    }

    const completedTurnPrefix = "ct-thinking-";
    if (thinkingId.startsWith(completedTurnPrefix)) {
      return parseIndex(thinkingId.split("-").at(-1));
    }

    return null;
  }, []);

  const thinkingState = useMemo(
    () => ({
      isCollapsed: (thinkingId: string): boolean => {
        const thinkingIndex = getThinkingIndex(thinkingId);
        if (thinkingIndex == null) return false;
        return !(isThinkingOpen?.(thinkingIndex) ?? false);
      },
      toggleCollapse: (thinkingId: string) => {
        const thinkingIndex = getThinkingIndex(thinkingId);
        if (thinkingIndex == null) return;
        onThinkingToggle?.(thinkingIndex);
      },
    }),
    [getThinkingIndex, isThinkingOpen, onThinkingToggle],
  );

  if (isLoading) {
    return (
      <div className={cn("space-y-3 p-4", className)}>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    );
  }

  if (!hasRenderableContent) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center p-6",
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">
          No transcript available
        </p>
      </div>
    );
  }

  const renderSegments = () => (
    <div className="space-y-3">
      {segments!.map((segment, index) =>
        segment.contentType === "thinking" ? (
          <ThinkingBlock
            key={index}
            content={segment.content}
            isStreaming={false}
            isCollapsed={!(isThinkingOpen?.(index) ?? false)}
            onToggleCollapse={() => onThinkingToggle?.(index)}
          />
        ) : (
          <MarkdownPreview
            key={index}
            content={segment.content}
            size="sm"
            components={taskIdComponents}
          />
        ),
      )}
    </div>
  );

  return (
    <ScrollArea className={cn("h-full min-w-0", className)} ref={scrollAreaRef}>
      <div className="max-w-3xl mx-auto w-full min-w-0 p-4">
        {hasMessages || hasStreamingBlocks ? (
          <ConversationTimeline
            className="space-y-3"
            messages={
              !isStreaming && streamingBlocks?.length
                ? conversationMessages.filter((m) => m.role === "user")
                : conversationMessages
            }
            timeZone={timeZone}
            isStreaming={isStreaming}
            streamingBlocks={isStreaming ? streamingBlocks : undefined}
            completedTurnBlocks={!isStreaming && streamingBlocks?.length ? [streamingBlocks] : undefined}
            thinkingBlockIsCollapsed={thinkingState.isCollapsed}
            thinkingBlockToggleCollapse={thinkingState.toggleCollapse}
            markdownComponents={taskIdComponents}
            onFeedback={onFeedback}
          />
        ) : hasSegments ? (
          renderSegments()
        ) : (
          <MarkdownPreview
            content={transcript}
            size="sm"
            components={taskIdComponents}
          />
        )}

        {showBackgroundAgentsWaiting ? (
          <BackgroundAgentsWaiting
            count={runningBackgroundAgentCount > 0 ? runningBackgroundAgentCount : undefined}
            agents={runningBackgroundAgents.length > 0 ? runningBackgroundAgents : undefined}
          />
        ) : isStreaming ? (
          <StreamingActivityIndicator startedAt={processingStartedAt} />
        ) : null}
      </div>
    </ScrollArea>
  );
};

function renderTextWithTaskLinks(
  text: string,
  taskIdMap: Map<string, ResolvedTaskId>,
): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  const regex = new RegExp(TASK_ID_REGEX.source, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const taskId = match[1];
    const resolved = taskIdMap.get(taskId);
    if (!resolved) continue;

    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    parts.push(
      <TaskIdLink
        key={`${taskId}-${match.index}`}
        taskId={taskId}
        workItemId={resolved.workItemId}
        boardArea={resolved.boardArea}
      />,
    );

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function processChildren(
  children: ReactNode,
  taskIdMap: Map<string, ResolvedTaskId>,
): ReactNode {
  if (typeof children === "string") {
    const parts = renderTextWithTaskLinks(children, taskIdMap);
    return parts.length > 0 ? parts : children;
  }

  if (Array.isArray(children)) {
    return children.map((child, index) => {
      if (typeof child === "string") {
        const parts = renderTextWithTaskLinks(child, taskIdMap);
        return parts.length > 0 ? <span key={index}>{parts}</span> : child;
      }
      return child;
    });
  }

  return children;
}
