import {
  ArrowLeft,
  Bot,
  Brain,
  Clock,
  MessageSquare,
  Sprout,
  LayoutList,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { ToolCallBlock } from "@/domains/shared/presentation/components/streaming-blocks/tool-call-block";
import { SubagentBlock } from "@/domains/shared/presentation/components/streaming-blocks/subagent-block";
import type {
  PlanningSession,
  PlanningMessage,
  PlanningSessionStatus,
} from "../../domain/types";

interface SessionReplayViewProps {
  session: PlanningSession | null;
  messages: PlanningMessage[];
  isLoading: boolean;
  error: Error | null;
  formatDate: (date: string) => string;
  formatDateTime: (date: string) => string;
  formatDuration: (ms: number | null) => string;
  onBack: () => void;
}

const statusConfig: Record<
  PlanningSessionStatus,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  active: { label: "Active", variant: "default" },
  completed: { label: "Completed", variant: "secondary" },
  archived: { label: "Archived", variant: "outline" },
  interrupted: { label: "Interrupted", variant: "outline" },
};

const getInitials = (name: string | null): string => {
  if (!name) return "?";
  return name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
};

// -- Sub-components (presentational, no hooks) --

const ReplayHeader: React.FC<{
  session: PlanningSession;
  formatDate: (date: string) => string;
  formatDuration: (ms: number | null) => string;
  onBack: () => void;
}> = ({ session, formatDate, formatDuration, onBack }) => {
  const statusInfo = statusConfig[session.status];

  return (
    <div className="flex flex-col gap-4 border-b bg-card px-6 py-5">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onBack}
          aria-label="Back to session history"
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="truncate text-lg font-semibold">{session.title}</h1>
          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
        </div>
      </div>

      {/* Meta info */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pl-11 text-sm text-muted-foreground">
        {session.projectName && (
          <span className="font-medium text-foreground">
            {session.projectName}
          </span>
        )}

        <span>{formatDate(session.createdAt)}</span>

        {session.completedAt && (
          <span>Completed {formatDate(session.completedAt)}</span>
        )}

        {formatDuration(session.durationMs) && (
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" />
            {formatDuration(session.durationMs)}
          </span>
        )}

        <span className="inline-flex items-center gap-1">
          <Sprout className="size-3.5" />
          {session.seedCount} seeds
        </span>

        <span className="inline-flex items-center gap-1">
          <LayoutList className="size-3.5" />
          {session.workItemCount} work items
        </span>
      </div>
    </div>
  );
};

const MessageBubble: React.FC<{
  message: PlanningMessage;
  session: PlanningSession;
  formatTime: (date: string) => string;
}> = ({ message, session, formatTime }) => {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : ""}`}
    >
      {/* Avatar */}
      {isUser ? (
        <Avatar className="size-8 shrink-0">
          {session.createdByUserImage && (
            <AvatarImage
              src={session.createdByUserImage}
              alt={session.createdByUserName ?? "User"}
            />
          )}
          <AvatarFallback className="text-xs">
            {getInitials(session.createdByUserName)}
          </AvatarFallback>
        </Avatar>
      ) : (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="size-4 text-primary" />
        </div>
      )}

      {/* Bubble */}
      <div
        className={`flex max-w-[75%] flex-col gap-1 ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "bg-primary text-primary-foreground whitespace-pre-wrap"
              : "bg-muted text-foreground"
          }`}
        >
          {isUser ? (
            message.content
          ) : (
            <MarkdownPreview content={message.content} size="sm" />
          )}
        </div>
        <span className="px-1 text-[11px] text-muted-foreground">
          {formatTime(message.createdAt)}
        </span>
      </div>
    </div>
  );
};

const ResultSummary: React.FC<{
  session: PlanningSession;
}> = ({ session }) => {
  if (!session.result?.summary) return null;

  return (
    <div className="mx-6 my-4">
      <Separator className="mb-4" />
      <div className="rounded-lg border bg-muted/30 p-4">
        <h3 className="mb-2 text-sm font-medium">Session Summary</h3>
        <div className="text-sm text-muted-foreground">
          <MarkdownPreview content={session.result.summary} size="sm" />
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          {session.result.seedsProcessed !== undefined && (
            <span>{session.result.seedsProcessed} seeds processed</span>
          )}
          {session.result.workItemsCreated !== undefined && (
            <span>{session.result.workItemsCreated} work items created</span>
          )}
        </div>
      </div>
    </div>
  );
};

// -- Main component --

export const SessionReplayView: React.FC<SessionReplayViewProps> = ({
  session,
  messages,
  isLoading,
  error,
  formatDate,
  formatDateTime,
  formatDuration,
  onBack,
}) => {
  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b px-6 py-5">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-6 w-64" />
        </div>
        <div className="flex flex-1 flex-col gap-4 p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 ${
                i % 2 === 0 ? "flex-row-reverse" : ""
              }`}
            >
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <Skeleton
                className={`h-16 rounded-xl ${
                  i % 2 === 0 ? "w-1/3" : "w-2/3"
                }`}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-destructive">
          Failed to load session: {error.message}
        </p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 size-4" />
          Back to history
        </Button>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <User className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Session not found</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 size-4" />
          Back to history
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <ReplayHeader
        session={session}
        formatDate={formatDate}
        formatDuration={formatDuration}
        onBack={onBack}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <MessageSquare className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No messages in this session.
              </p>
            </div>
          ) : (
            messages.map((message) => {
              // Tool call messages — render as structured ToolCallBlock
              if (message.messageType === "tool_call") {
                const meta = message.metadata as Record<string, unknown> | undefined;
                return (
                  <ToolCallBlock
                    key={message.id}
                    toolName={(meta?.toolName as string) ?? "unknown"}
                    toolCallId={(meta?.toolCallId as string) ?? message.id}
                    status="success"
                    inputPreview={meta?.inputPreview as string | undefined}
                  />
                );
              }

              // Subagent messages — render as SubagentBlock
              if (message.messageType === "subagent") {
                const meta = message.metadata as Record<string, unknown> | undefined;
                return (
                  <SubagentBlock
                    key={message.id}
                    subagentId={(meta?.subagentId as string) ?? message.id}
                    description={(meta?.description as string) ?? ""}
                    isBackground={(meta?.isBackground as boolean) ?? false}
                    status="done"
                    subagentType={meta?.subagentType as string | undefined}
                  />
                );
              }

              // Thinking messages — render as collapsible block
              if (message.messageType === "thinking") {
                return (
                  <div key={message.id} className="flex items-start gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-purple-500/10">
                      <Brain className="size-4 text-purple-500" />
                    </div>
                    <details className="max-w-[75%]">
                      <summary className="cursor-pointer text-xs font-medium text-purple-500/70 select-none">
                        Thinking...
                      </summary>
                      <div className="mt-1 rounded-xl bg-muted/50 border border-purple-500/10 px-4 py-2.5 text-sm leading-relaxed text-muted-foreground">
                        <MarkdownPreview content={message.content} size="sm" />
                      </div>
                    </details>
                  </div>
                );
              }

              // Skip empty non-structured messages (e.g. stream artifacts)
              if (!message.content.trim() && !message.messageType) {
                return null;
              }

              // Skip legacy control-token-only system messages from older planning sessions.
              if (message.role === "system") {
                const cleaned = message.content
                  .replace(/\[WAITING\].*$/gm, "")
                  .replace(/\[STEP\]/g, "")
                  .replace(/\[DONE\]/g, "")
                  .replace(/\[RESPONSE_COMPLETE\]/g, "")
                  .trim();
                if (!cleaned) return null;
              }

              // Default: render as MessageBubble
              return (
                <MessageBubble
                  key={message.id}
                  message={message}
                  session={session}
                  formatTime={formatDateTime}
                />
              );
            })
          )}
        </div>

        {/* Result summary */}
        <ResultSummary session={session} />
      </div>
    </div>
  );
};
