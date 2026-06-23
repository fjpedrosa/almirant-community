import { cn } from "@/lib/utils";
import {
  ToolCallBlock,
  FileOperationBlock,
  BashBlock,
  SubagentBlock,
  SubagentGroupBlock,
  ActivityBurstBlock,
  SessionReconnectBlock,
  SummaryBlock,
} from "@/domains/shared/presentation/components/streaming-blocks";
import type {
  ConversationMessage as ConversationMessageType,
  ConversationTimelineProps,
} from "../../domain/conversation-types";
import type { StreamingBlock } from "@/domains/shared/domain/streaming-block-types";
import { groupStreamingBlocks } from "@/domains/shared/application/utils/streaming-block-utils";
import { ConversationMessage } from "./conversation-message";

const parseQuestionMessage = (
  content: string,
): { question: string; options: string[] } | null => {
  const questionMatch = content.match(/\[QUESTION\]\s*(.*?)(?:\n|$)/);
  if (!questionMatch) return null;

  const question = questionMatch[1]?.trim() ?? "";
  const optionsMatch = content.match(/\[OPTIONS\]\s*(.*?)$/m);
  const options = optionsMatch
    ? optionsMatch[1]?.split("|").map((option) => option.trim()).filter(Boolean) ?? []
    : [];

  return { question, options };
};

const findAnswer = (
  messages: ConversationMessageType[],
  currentIndex: number,
): string | null => {
  for (let index = currentIndex + 1; index < messages.length; index++) {
    if (messages[index].role === "user") return messages[index].content;
    if (messages[index].role === "system") break;
  }
  return null;
};

const parseOption = (raw: string): { label: string; description?: string } => {
  const separatorIndex = raw.indexOf("::");
  if (separatorIndex === -1) return { label: raw };
  return {
    label: raw.slice(0, separatorIndex),
    description: raw.slice(separatorIndex + 2),
  };
};

const normalizeTextForDedup = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const getPersistentBlockKey = (block: StreamingBlock): string | null => {
  switch (block.type) {
    case "tool_call":
      return `tool_call:${block.toolCallId}`;
    case "subagent":
      return `subagent:${block.subagentId}`;
    case "text":
    case "info": {
      const normalized = normalizeTextForDedup(block.content);
      return normalized ? `text:${normalized}` : null;
    }
    default:
      return null;
  }
};

const getPersistentMessageKey = (
  message: ConversationMessageType,
): string | null => {
  const metadata = message.metadata as Record<string, unknown> | undefined;

  if (message.messageType === "tool_call") {
    const toolCallId =
      typeof metadata?.toolCallId === "string" ? metadata.toolCallId : message.id;
    return `tool_call:${toolCallId}`;
  }

  if (message.messageType === "subagent") {
    const subagentId =
      typeof metadata?.subagentId === "string" ? metadata.subagentId : message.id;
    return `subagent:${subagentId}`;
  }

  if (
    message.role === "assistant" &&
    message.messageType !== "thinking" &&
    typeof message.content === "string"
  ) {
    const normalized = normalizeTextForDedup(message.content);
    return normalized ? `text:${normalized}` : null;
  }

  return null;
};

const QuestionBlock: React.FC<{
  question: string;
  options: string[];
  answer: string | null;
}> = ({ question, options, answer }) => {
  const parsedOptions = options.map(parseOption);

  return (
    <div className="py-3 px-4 space-y-2.5">
      <p className="text-sm font-semibold text-foreground">{question}</p>
      {parsedOptions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {parsedOptions.map(({ label, description }) => {
            const isSelected =
              answer != null && label.toLowerCase() === answer.toLowerCase();
            return (
              <div
                key={label}
                className={cn(
                  "rounded-lg border px-3 py-2 transition-colors",
                  isSelected
                    ? "bg-primary/10 border-primary/30"
                    : "bg-muted/30 border-border/30",
                )}
              >
                <span
                  className={cn(
                    "text-sm",
                    isSelected
                      ? "font-medium text-primary"
                      : "font-medium text-foreground/70",
                  )}
                >
                  {label}
                </span>
                {description && (
                  <p
                    className={cn(
                      "text-xs mt-0.5",
                      isSelected ? "text-primary/70" : "text-muted-foreground",
                    )}
                  >
                    {description}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const ConversationTimeline: React.FC<ConversationTimelineProps> = ({
  messages,
  timeZone,
  streamingContent,
  isStreaming,
  streamingThinkingContent,
  streamingBlocks,
  completedTurnBlocks,
  thinkingBlockIsCollapsed,
  thinkingBlockToggleCollapse,
  isSessionCompleted,
  labels,
  markdownComponents,
  className,
  onFeedback,
}) => {
  const groupedBlocks = streamingBlocks ? groupStreamingBlocks(streamingBlocks) : [];
  const activeStreamingBlockKeys = new Set(
    (streamingBlocks ?? [])
      .map((block) => getPersistentBlockKey(block))
      .filter((key): key is string => key != null),
  );
  const hasCurrentTurnBlocks =
    isStreaming && streamingBlocks != null && streamingBlocks.length > 0;
  const lastUserMsgIndex = hasCurrentTurnBlocks
    ? (() => {
        for (let index = messages.length - 1; index >= 0; index--) {
          if (messages[index].role === "user") return index;
        }
        return -1;
      })()
    : -1;

  type MergedMessage = ConversationMessageType & {
    _mergedIds?: string[];
    _toolBlock?: StreamingBlock;
    _sourceIndex: number;
  };

  const mergedMessages: MergedMessage[] = [];

  for (let index = 0; index < messages.length; index++) {
    let message = messages[index];
    const messageMetadata = message.metadata as Record<string, unknown> | undefined;
    const isGraduatedLiveTurnMessage =
      messageMetadata?.fromLiveStreamingTurn === true;

    if (
      hasCurrentTurnBlocks &&
      (lastUserMsgIndex < 0 || index > lastUserMsgIndex) &&
      message.role === "assistant" &&
      !isGraduatedLiveTurnMessage
    ) {
      const persistentMessageKey = getPersistentMessageKey(message);
      if (
        !persistentMessageKey ||
        activeStreamingBlockKeys.has(persistentMessageKey)
      ) {
        continue;
      }
    }

    if (message.messageType === "tool_call" || message.messageType === "subagent") {
      const meta = message.metadata as Record<string, unknown> | undefined;

      if (
        message.messageType === "tool_call" &&
        (meta?.toolName as string) === "AskUserQuestion"
      ) {
        const alreadyHasAsk = mergedMessages.some(
          (merged) =>
            merged._toolBlock?.type === "tool_call" &&
            merged._toolBlock.toolName === "AskUserQuestion",
        );
        if (alreadyHasAsk) continue;
      }

      if (message.messageType === "tool_call") {
        const toolCallId = (meta?.toolCallId as string) ?? message.id;
        const inputPreview = meta?.inputPreview as string | undefined;
        const existingIndex = mergedMessages.findIndex(
          (merged) =>
            merged._toolBlock?.type === "tool_call" &&
            merged._toolBlock.toolCallId === toolCallId,
        );

        if (existingIndex >= 0) {
          const previousBlock = mergedMessages[existingIndex]._toolBlock;
          if (
            previousBlock?.type === "tool_call" &&
            previousBlock.inputPreview?.startsWith("{") &&
            inputPreview &&
            !inputPreview.startsWith("{")
          ) {
            mergedMessages[existingIndex] = {
              ...message,
              _sourceIndex: index,
              _toolBlock: {
                type: "tool_call",
                toolName: (meta?.toolName as string) ?? "unknown",
                toolCallId,
                status: "success",
                inputPreview,
              },
            };
          }
          continue;
        }

        mergedMessages.push({
          ...message,
          _sourceIndex: index,
          _toolBlock: {
            type: "tool_call",
            toolName: (meta?.toolName as string) ?? "unknown",
            toolCallId,
            status: "success",
            inputPreview,
          },
        });
      } else {
        const subagentId = (meta?.subagentId as string) ?? message.id;
        const description = (meta?.description as string) ?? "";
        const subagentType = meta?.subagentType as string | undefined;
        const existingIndex = mergedMessages.findIndex(
          (merged) =>
            merged._toolBlock?.type === "subagent" &&
            merged._toolBlock.subagentId === subagentId,
        );

        if (existingIndex >= 0) {
          const previousBlock = mergedMessages[existingIndex]._toolBlock;
          if (
            previousBlock?.type === "subagent" &&
            ((!previousBlock.subagentType && subagentType) ||
              previousBlock.description === "Agent")
          ) {
            mergedMessages[existingIndex] = {
              ...message,
              _sourceIndex: index,
              _toolBlock: {
                type: "subagent",
                subagentId,
                description,
                isBackground: (meta?.isBackground as boolean) ?? false,
                status: "done",
                subagentType,
              },
            };
          }
          continue;
        }

        mergedMessages.push({
          ...message,
          _sourceIndex: index,
          _toolBlock: {
            type: "subagent",
            subagentId,
            description,
            isBackground: (meta?.isBackground as boolean) ?? false,
            status: "done",
            subagentType,
          },
        });
      }
      continue;
    }

    if (message.role === "assistant" && message.messageType !== "thinking" && message.content) {
      const toolUsePattern = /^\s*\{"name":"[A-Za-z].*"id":"toolu_/;
      const lines = message.content.split("\n");
      const hasToolJson = lines.some((line: string) => toolUsePattern.test(line));

      if (hasToolJson) {
        const textLines: string[] = [];
        for (const line of lines) {
          if (toolUsePattern.test(line)) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.name && parsed.id) {
                mergedMessages.push({
                  ...message,
                  id: `${message.id}-tool-${parsed.id}`,
                  content: "",
                  _sourceIndex: index,
                  _toolBlock: {
                    type: "tool_call",
                    toolName: parsed.name,
                    toolCallId: parsed.id,
                    status: "success",
                    inputPreview: parsed.input
                      ? JSON.stringify(parsed.input).slice(0, 80)
                      : undefined,
                  },
                });
              }
            } catch {
              textLines.push(line);
            }
          } else {
            textLines.push(line);
          }
        }

        const cleaned = textLines.join("\n").trim();
        if (cleaned) {
          message = { ...message, content: cleaned };
        } else {
          continue;
        }
      }
    }

    const isAssistantText =
      message.role === "assistant" && message.messageType !== "thinking";
    const isThinking =
      message.role === "assistant" && message.messageType === "thinking";
    const previous =
      mergedMessages.length > 0 ? mergedMessages[mergedMessages.length - 1] : null;
    const previousIsAssistantText =
      previous &&
      !previous._toolBlock &&
      previous.role === "assistant" &&
      previous.messageType !== "thinking";
    const previousIsThinking =
      previous &&
      !previous._toolBlock &&
      previous.role === "assistant" &&
      previous.messageType === "thinking";

    if (isAssistantText && previousIsAssistantText) {
      const previousTrimmed = previous.content.trimEnd();
      const currentTrimmed = message.content.trimStart();
      const previousEndsWithTable = previousTrimmed
        .split("\n")
        .pop()
        ?.trimStart()
        .startsWith("|");
      const currentStartsWithTable = currentTrimmed.startsWith("|");
      const separator =
        previousEndsWithTable && currentStartsWithTable ? "\n" : "\n\n";
      previous.content = previousTrimmed + separator + currentTrimmed;
      previous.timestamp = message.timestamp;
      if (!previous._mergedIds) previous._mergedIds = [previous.id];
      previous._mergedIds.push(message.id);
    } else if (isThinking && previousIsThinking) {
      previous.content = previous.content.trimEnd() + "\n" + message.content.trimStart();
      if (!previous._mergedIds) previous._mergedIds = [previous.id];
      previous._mergedIds.push(message.id);
    } else {
      mergedMessages.push({
        ...message,
        _sourceIndex: index,
      });
    }
  }

  const hiddenBurstTools = new Set(["Bash", "ToolSearch", "Agent", "Task"]);

  type DisplayItem =
    | {
        kind: "message";
        message: MergedMessage;
        index: number;
      }
    | {
        kind: "burst";
        groups: Array<{
          toolName: string;
          count: number;
          blocks: StreamingBlock[];
        }>;
        key: string;
      }
    | {
        kind: "db-subagent-group";
        subagents: Array<{
          subagentId: string;
          description: string;
          isBackground: boolean;
          status: "running" | "done";
          subagentType?: string;
          nestedToolCalls: Array<{
            toolName: string;
            toolCallId: string;
            status: "pending" | "success" | "error";
            description?: string;
            filePath?: string;
            command?: string;
            inputPreview?: string;
          }>;
        }>;
        key: string;
      };

  const displayItems: DisplayItem[] = [];
  let displayIndex = 0;

  while (displayIndex < mergedMessages.length) {
    const message = mergedMessages[displayIndex];

    if (message._toolBlock?.type === "subagent") {
      const subagents: Array<{
        subagentId: string;
        description: string;
        isBackground: boolean;
        status: "running" | "done";
        subagentType?: string;
        nestedToolCalls: Array<{
          toolName: string;
          toolCallId: string;
          status: "pending" | "success" | "error";
          description?: string;
          filePath?: string;
          command?: string;
          inputPreview?: string;
        }>;
      }> = [];
      const startIndex = displayIndex;
      while (
        displayIndex < mergedMessages.length &&
        mergedMessages[displayIndex]._toolBlock?.type === "subagent"
      ) {
        const subagent = mergedMessages[displayIndex]._toolBlock;
        const meta = mergedMessages[displayIndex].metadata as Record<string, unknown> | undefined;
        if (subagent?.type === "subagent") {
          const nestedToolCalls = Array.isArray(meta?.nestedToolCalls)
            ? (meta.nestedToolCalls as Array<{
                toolName: string;
                toolCallId: string;
                status: "pending" | "success" | "error";
                description?: string;
                filePath?: string;
                command?: string;
                inputPreview?: string;
              }>)
            : [];
          subagents.push({
            subagentId: subagent.subagentId,
            description: subagent.description,
            isBackground: subagent.isBackground,
            status: subagent.status,
            subagentType: subagent.subagentType,
            nestedToolCalls,
          });
        }
        displayIndex++;
      }
      displayItems.push({
        kind: "db-subagent-group",
        subagents,
        key: `db-sg-${startIndex}`,
      });
      continue;
    }

    if (message._toolBlock?.type === "tool_call") {
      const burstBlocks: StreamingBlock[] = [];
      const burstMessageIndexes: number[] = [];
      const startIndex = displayIndex;
      while (
        displayIndex < mergedMessages.length &&
        mergedMessages[displayIndex]._toolBlock?.type === "tool_call"
      ) {
        const block = mergedMessages[displayIndex]._toolBlock;
        if (block?.type === "tool_call" && !hiddenBurstTools.has(block.toolName)) {
          burstBlocks.push(block);
          burstMessageIndexes.push(displayIndex);
        }
        displayIndex++;
      }

      if (burstBlocks.length >= 2) {
        const groupMap = new Map<string, StreamingBlock[]>();
        for (const block of burstBlocks) {
          if (block.type !== "tool_call") continue;
          if (!groupMap.has(block.toolName)) groupMap.set(block.toolName, []);
          groupMap.get(block.toolName)!.push(block);
        }
        displayItems.push({
          kind: "burst",
          groups: Array.from(groupMap.entries()).map(([toolName, blocks]) => ({
            toolName,
            count: blocks.length,
            blocks,
          })),
          key: `db-burst-${startIndex}`,
        });
      } else if (burstBlocks.length === 1) {
        const visibleIndex = burstMessageIndexes[0];
        displayItems.push({
          kind: "message",
          message: mergedMessages[visibleIndex],
          index: visibleIndex,
        });
      }
      continue;
    }

    displayItems.push({
      kind: "message",
      message,
      index: displayIndex,
    });
    displayIndex++;
  }

  let lastAssistantTextItemIndex = -1;
  for (let index = displayItems.length - 1; index >= 0; index--) {
    const item = displayItems[index];
    if (
      item.kind === "message" &&
      !item.message._toolBlock &&
      item.message.role === "assistant" &&
      item.message.messageType !== "thinking"
    ) {
      lastAssistantTextItemIndex = index;
      break;
    }
  }

  const persistedBlockKeys = new Set(
    mergedMessages
      .map((message) =>
        message._toolBlock ? getPersistentBlockKey(message._toolBlock) : null,
      )
      .filter((key): key is string => key != null),
  );

  return (
    <div className={cn("space-y-2 w-full", className)}>
      {displayItems.map((item, index) => {
        if (item.kind === "burst") {
          return <ActivityBurstBlock key={item.key} groups={item.groups} />;
        }

        if (item.kind === "db-subagent-group") {
          return <SubagentGroupBlock key={item.key} subagents={item.subagents} />;
        }

        const message = item.message;

        if (message._toolBlock) {
          const block = message._toolBlock;
          if (block.type === "tool_call") {
            if (hiddenBurstTools.has(block.toolName)) return null;
            return (
              <ToolCallBlock
                key={message.id}
                toolName={block.toolName}
                toolCallId={block.toolCallId}
                status={block.status}
                inputPreview={block.inputPreview}
                filePath={block.filePath}
                command={block.command}
                description={block.description}
              />
            );
          }

          if (block.type === "subagent") {
            return (
              <SubagentBlock
                key={message.id}
                subagentId={block.subagentId}
                description={block.description}
                isBackground={block.isBackground}
                status={block.status}
                subagentType={block.subagentType}
              />
            );
          }

          return null;
        }

        if (message.role === "system") {
          const parsed = parseQuestionMessage(message.content);
          if (parsed && parsed.question) {
            const answer = findAnswer(messages, message._sourceIndex);
            if (!answer) return null;
            return (
              <QuestionBlock
                key={message.id}
                question={parsed.question}
                options={parsed.options}
                answer={answer}
              />
            );
          }

          const displayText = message.content
            .replace(/\[QUESTION\]/g, "❓")
            .replace(/\[WAITING\].*$/g, "")
            .replace(/\[STEP\]/g, "📋")
            .replace(/\[DONE\]/g, "✅")
            .replace(/\[ERROR\]/g, "❌")
            .replace(/\[RESPONSE_COMPLETE\]/g, "✅")
            .replace(/\[OPTIONS\]/g, "")
            .trim();

          if (!displayText) return null;

          return (
            <div key={message.id} className="flex items-center gap-3 py-2">
              <div className="flex-1 border-t border-dashed border-muted-foreground/40" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {displayText}
              </span>
              <div className="flex-1 border-t border-dashed border-muted-foreground/40" />
            </div>
          );
        }

        const isLastAssistantText = index === lastAssistantTextItemIndex;
        const isAssistantMessage = message.role === "assistant" && message.messageType !== "thinking";

        return (
          <ConversationMessage
            key={message.id}
            role={message.role}
            content={message.content}
            timestamp={message.timestamp}
            timeZone={timeZone}
            messageType={message.messageType}
            seeds={message.seeds}
            deliveryStatus={message.deliveryStatus}
            isCollapsed={
              message.messageType === "thinking" && thinkingBlockIsCollapsed
                ? thinkingBlockIsCollapsed(message.id)
                : undefined
            }
            onToggleCollapse={
              message.messageType === "thinking" && thinkingBlockToggleCollapse
                ? () => thinkingBlockToggleCollapse(message.id)
                : undefined
            }
            isLastMessage={isLastAssistantText}
            isSessionCompleted={isSessionCompleted}
            labels={labels}
            markdownComponents={markdownComponents}
            messageId={isAssistantMessage ? message.id : undefined}
            onFeedback={isAssistantMessage ? onFeedback : undefined}
          />
        );
      })}

      {(completedTurnBlocks ?? []).map((turnBlocks, turnIndex) => {
          const visibleTurnBlocks = turnBlocks.filter((block) => {
            const blockKey = getPersistentBlockKey(block);
            return blockKey == null || !persistedBlockKeys.has(blockKey);
          });

          if (visibleTurnBlocks.length === 0) return null;

          const groupedTurnBlocks = groupStreamingBlocks(visibleTurnBlocks);
          return groupedTurnBlocks.map((group, groupIndex) => {
            if (group.kind === "subagent-group") {
              return (
                <SubagentGroupBlock
                  key={`ct-${turnIndex}-sg-${groupIndex}`}
                  subagents={group.subagents}
                />
              );
            }

            if (group.kind === "tool-group") {
              return (
                <ToolCallBlock
                  key={`ct-${turnIndex}-tg-${groupIndex}`}
                  toolName={group.lastBlock.toolName}
                  toolCallId={group.lastBlock.toolCallId}
                  status={group.lastBlock.status}
                  inputPreview={group.lastBlock.inputPreview}
                  filePath={group.lastBlock.filePath}
                  command={group.lastBlock.command}
                  description={group.lastBlock.description}
                  groupCount={group.count}
                />
              );
            }

            if (group.kind === "activity-burst") {
              return (
                <ActivityBurstBlock
                  key={`ct-${turnIndex}-ab-${groupIndex}`}
                  groups={group.groups}
                />
              );
            }

            const block = group.block;
            const blockKey = `ct-${turnIndex}-${group.index}`;
            switch (block.type) {
              case "tool_call":
                return (
                  <ToolCallBlock
                    key={blockKey}
                    toolName={block.toolName}
                    toolCallId={block.toolCallId}
                    status={block.status}
                    inputPreview={block.inputPreview}
                    filePath={block.filePath}
                    command={block.command}
                    description={block.description}
                  />
                );
              case "file_read":
                return (
                  <FileOperationBlock
                    key={blockKey}
                    filePath={block.filePath}
                    operation="read"
                    lineRange={block.lineRange}
                  />
                );
              case "file_change":
                return (
                  <FileOperationBlock
                    key={blockKey}
                    filePath={block.filePath}
                    operation={block.operation}
                  />
                );
              case "bash":
                return (
                  <BashBlock
                    key={blockKey}
                    command={block.command}
                    description={block.description}
                    output={block.output}
                  />
                );
              case "session-reconnect":
                return (
                  <SessionReconnectBlock
                    key={blockKey}
                    timestamp={block.timestamp}
                  />
                );
              case "summary":
                return (
                  <SummaryBlock
                    key={blockKey}
                    text={block.text}
                    section={block.section}
                  />
                );
              case "text":
                return (
                  <ConversationMessage
                    key={blockKey}
                    role="assistant"
                    content={block.content}
                    timeZone={timeZone}
                    labels={labels}
                    markdownComponents={markdownComponents}
                  />
                );
              case "info":
                return (
                  <ConversationMessage
                    key={blockKey}
                    role="assistant"
                    content={block.content}
                    timeZone={timeZone}
                    labels={labels}
                    markdownComponents={markdownComponents}
                  />
                );
              case "thinking": {
                const thinkingId = `ct-thinking-${turnIndex}-${group.index}`;
                const collapsed = thinkingBlockIsCollapsed
                  ? thinkingBlockIsCollapsed(thinkingId)
                  : true;
                return (
                  <ConversationMessage
                    key={blockKey}
                    role="assistant"
                    content={block.content}
                    messageType="thinking"
                    timeZone={timeZone}
                    isCollapsed={collapsed}
                    onToggleCollapse={
                      thinkingBlockToggleCollapse
                        ? () => thinkingBlockToggleCollapse(thinkingId)
                        : undefined
                    }
                    labels={labels}
                  />
                );
              }
              default:
                return null;
            }
          });
        })}

      {groupedBlocks.length > 0
        ? groupedBlocks.map((group) => {
            if (group.kind === "subagent-group") {
              return (
                <SubagentGroupBlock
                  key={`sg-${group.startIndex}`}
                  subagents={group.subagents}
                />
              );
            }

            if (group.kind === "tool-group") {
              return (
                <ToolCallBlock
                  key={`tg-${group.startIndex}`}
                  toolName={group.lastBlock.toolName}
                  toolCallId={group.lastBlock.toolCallId}
                  status={group.lastBlock.status}
                  inputPreview={group.lastBlock.inputPreview}
                  filePath={group.lastBlock.filePath}
                  command={group.lastBlock.command}
                  description={group.lastBlock.description}
                  groupCount={group.count}
                />
              );
            }

            if (group.kind === "activity-burst") {
              return (
                <ActivityBurstBlock
                  key={`ab-${group.startIndex}`}
                  groups={group.groups}
                />
              );
            }

            const block = group.block;
            const blockIndex = group.index;
            const isLastBlock =
              isStreaming && blockIndex === (streamingBlocks?.length ?? 0) - 1;

            switch (block.type) {
              case "thinking": {
                const thinkingId = `stream-thinking-${blockIndex}`;
                const collapsed = thinkingBlockIsCollapsed
                  ? thinkingBlockIsCollapsed(thinkingId)
                  : true;
                return (
                  <ConversationMessage
                    key={`stream-block-${blockIndex}`}
                    role="assistant"
                    content={block.content}
                    messageType="thinking"
                    timeZone={timeZone}
                    isStreaming={isLastBlock}
                    isCollapsed={collapsed}
                    onToggleCollapse={
                      thinkingBlockToggleCollapse
                        ? () => thinkingBlockToggleCollapse(thinkingId)
                        : undefined
                    }
                    labels={labels}
                  />
                );
              }
              case "text":
              case "info":
                return (
                  <ConversationMessage
                    key={`stream-block-${blockIndex}`}
                    role="assistant"
                    content={block.content}
                    timeZone={timeZone}
                    isStreaming={isLastBlock && block.type === "text"}
                    labels={labels}
                    markdownComponents={markdownComponents}
                  />
                );
              case "tool_call":
                return (
                  <ToolCallBlock
                    key={`stream-block-${blockIndex}`}
                    toolName={block.toolName}
                    toolCallId={block.toolCallId}
                    status={block.status}
                    inputPreview={block.inputPreview}
                    filePath={block.filePath}
                    command={block.command}
                    description={block.description}
                  />
                );
              case "file_read":
                return (
                  <FileOperationBlock
                    key={`stream-block-${blockIndex}`}
                    filePath={block.filePath}
                    operation="read"
                    lineRange={block.lineRange}
                  />
                );
              case "file_change":
                return (
                  <FileOperationBlock
                    key={`stream-block-${blockIndex}`}
                    filePath={block.filePath}
                    operation={block.operation}
                  />
                );
              case "bash":
                return (
                  <BashBlock
                    key={`stream-block-${blockIndex}`}
                    command={block.command}
                    description={block.description}
                    output={block.output}
                  />
                );
              case "subagent":
                return (
                  <SubagentBlock
                    key={`stream-block-${blockIndex}`}
                    subagentId={block.subagentId}
                    description={block.description}
                    isBackground={block.isBackground}
                    status={block.status}
                    subagentType={block.subagentType}
                  />
                );
              case "session-reconnect":
                return (
                  <SessionReconnectBlock
                    key={`stream-block-${blockIndex}`}
                    timestamp={block.timestamp}
                  />
                );
              case "summary":
                return (
                  <SummaryBlock
                    key={`stream-block-${blockIndex}`}
                    text={block.text}
                    section={block.section}
                  />
                );
              default:
                return null;
            }
          })
        : isStreaming && (
            <>
              {streamingThinkingContent != null && streamingThinkingContent !== "" && (
                <ConversationMessage
                  role="assistant"
                  content={streamingThinkingContent}
                  messageType="thinking"
                  timeZone={timeZone}
                  isStreaming
                  isCollapsed={
                    thinkingBlockIsCollapsed
                      ? thinkingBlockIsCollapsed("stream-thinking-fallback")
                      : true
                  }
                  onToggleCollapse={
                    thinkingBlockToggleCollapse
                      ? () => thinkingBlockToggleCollapse("stream-thinking-fallback")
                      : undefined
                  }
                  labels={labels}
                />
              )}
              {streamingContent ? (
                <ConversationMessage
                  role="assistant"
                  content={streamingContent}
                  timeZone={timeZone}
                  isStreaming
                  labels={labels}
                  markdownComponents={markdownComponents}
                />
              ) : !streamingThinkingContent ? (
                <ConversationMessage
                  role="assistant"
                  content=""
                  timeZone={timeZone}
                  isStreaming
                  labels={labels}
                />
              ) : null}
            </>
          )}
    </div>
  );
};
