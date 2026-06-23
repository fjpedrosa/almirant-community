/** @deprecated Use chat-full-panel.tsx instead */
import { useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChatMessageList } from "./chat-message-list";
import { ChatInput } from "./chat-input";
import { ActiveModelBadge } from "./active-model-badge";
import { GenerationConfirmPanel } from "./generation-confirm-panel";
import { useChatInput } from "../../application/hooks/use-chat-input";
import type { ChatPanelProps } from "../../domain/types";

export const ChatPanel: React.FC<ChatPanelProps> = ({
  providerLabel,
  model,
  showModelBadge,
  messages,
  streamingContent,
  isStreaming,
  onSendMessage,
  showGeneration,
  previewItems,
  columns,
  activeColumnId,
  activeItemCount,
  isConfirming,
  onUpdateItem,
  onRemoveItem,
  onColumnChange,
  onConfirmGeneration,
  onCancelGeneration,
  isAlreadyCreated,
}) => {
  const t = useTranslations("aiPlanning");
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatInput = useChatInput(onSendMessage);

  return (
    <div className="flex flex-col h-full min-h-0">
      <ActiveModelBadge
        providerLabel={providerLabel}
        model={model}
        visible={showModelBadge}
      />

      {showGeneration ? (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Column selector (hidden when items are already created) */}
          {!isAlreadyCreated && (
            <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
              <label className="text-xs text-muted-foreground whitespace-nowrap">
                {t("selectColumn")}:
              </label>
              <Select value={activeColumnId} onValueChange={onColumnChange}>
                <SelectTrigger className="w-[200px] h-8 text-xs">
                  <SelectValue placeholder={t("selectColumn")} />
                </SelectTrigger>
                <SelectContent>
                  {columns
                    .filter((col) => !col.isDone)
                    .map((col) => (
                      <SelectItem key={col.id} value={col.id}>
                        <span className="flex items-center gap-2">
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: col.color }}
                          />
                          {col.name}
                        </span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            <GenerationConfirmPanel
              items={previewItems}
              onUpdateItem={onUpdateItem}
              onRemoveItem={onRemoveItem}
              onConfirm={onConfirmGeneration}
              onCancel={onCancelGeneration}
              isConfirming={isConfirming}
              itemCount={activeItemCount}
              isAlreadyCreated={isAlreadyCreated}
            />
          </div>
        </div>
      ) : (
        <>
          <ChatMessageList
            messages={messages}
            streamingContent={streamingContent}
            isStreaming={isStreaming}
            bottomRef={bottomRef}
          />
          <ChatInput
            onSend={onSendMessage}
            isStreaming={isStreaming}
            value={chatInput.value}
            onChange={chatInput.onChange}
            canSend={chatInput.canSend}
            onSendAction={chatInput.onSend}
            onKeyDown={chatInput.onKeyDown}
          />
        </>
      )}
    </div>
  );
};
