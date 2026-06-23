import {
  Send,
  Loader2,
  RefreshCw,
  Save,
  Bot,
  User,
  Sparkles,
  X,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { cn } from "@/lib/utils";
import type {
  SkillChatCreatorProps,
  SkillChatMessage,
  GeneratedSkill,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Sub-components (pure presentational)
// ---------------------------------------------------------------------------

interface MessageBubbleProps {
  message: SkillChatMessage;
  isGenerating?: boolean;
}

const MessageBubble = ({ message, isGenerating }: MessageBubbleProps) => {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex gap-3 w-full",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "flex-shrink-0 size-8 rounded-full flex items-center justify-center",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
      >
        {isUser ? <User className="size-4" /> : <Bot className="size-4" />}
      </div>

      {/* Message content */}
      <div
        className={cn(
          "flex flex-col gap-1 max-w-[80%]",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          )}
        >
          {isUser ? (
            <p className="text-sm whitespace-pre-wrap break-words">
              {message.content}
            </p>
          ) : message.content ? (
            <div className="text-sm">
              <MarkdownPreview content={message.content} size="sm" />
            </div>
          ) : isGenerating ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>Generating...</span>
            </div>
          ) : null}
        </div>
        <time className="text-xs text-muted-foreground px-1">
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>
    </div>
  );
};

interface SkillPreviewCardProps {
  skill: GeneratedSkill;
  onSave: () => void;
  isSaving?: boolean;
}

const SkillPreviewCard = ({ skill, onSave, isSaving }: SkillPreviewCardProps) => {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <span className="text-sm font-medium text-primary">
            Generated Skill
          </span>
        </div>
        <Button
          size="sm"
          onClick={onSave}
          disabled={isSaving}
          className="gap-2"
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Save Skill
        </Button>
      </div>

      {/* Skill metadata */}
      <div className="space-y-2">
        <div>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Name
          </span>
          <p className="text-sm font-medium text-foreground mt-0.5">
            {skill.name}
          </p>
        </div>
        {skill.description && (
          <div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Description
            </span>
            <p className="text-sm text-foreground/80 mt-0.5">
              {skill.description}
            </p>
          </div>
        )}
      </div>

      {/* Content preview */}
      <div>
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Content Preview
        </span>
        <div className="mt-2 rounded-lg border bg-background/50 p-3 max-h-64 overflow-auto">
          <MarkdownPreview content={skill.content} size="sm" />
        </div>
      </div>
    </div>
  );
};

interface ErrorBannerProps {
  error: string;
  onDismiss: () => void;
}

const ErrorBanner = ({ error, onDismiss }: ErrorBannerProps) => {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3">
      <AlertCircle className="size-5 text-destructive flex-shrink-0" />
      <p className="text-sm text-destructive flex-1">{error}</p>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 text-destructive hover:text-destructive hover:bg-destructive/20"
        onClick={onDismiss}
        aria-label="Dismiss error"
      >
        <X className="size-4" />
      </Button>
    </div>
  );
};

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled: boolean;
  isLoading: boolean;
}

const ChatInput = ({
  value,
  onChange,
  onSend,
  disabled,
  isLoading,
}: ChatInputProps) => {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !disabled) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex gap-2 items-end">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe the skill you want to create... (Ctrl+Enter to send)"
        disabled={disabled}
        className="min-h-[80px] resize-none"
        rows={3}
      />
      <Button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        size="icon"
        className="size-10 flex-shrink-0"
        aria-label="Send message"
      >
        {isLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
      </Button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

/**
 * SkillChatCreator - A chat UI component for AI-assisted skill creation.
 *
 * This is a purely presentational component. All state management and
 * business logic should be handled by the parent container.
 *
 * Usage:
 * ```tsx
 * <SkillChatCreator
 *   messages={messages}
 *   status={status}
 *   generatedSkill={generatedSkill}
 *   error={error}
 *   onSendMessage={handleSend}
 *   onReset={handleReset}
 *   onClearError={handleClearError}
 *   onSaveSkill={handleSave}
 *   inputValue={input}
 *   onInputChange={setInput}
 *   scrollRef={scrollRef}
 * />
 * ```
 */
export const SkillChatCreator = ({
  messages,
  status,
  generatedSkill,
  error,
  onSendMessage,
  onReset,
  onClearError,
  onSaveSkill,
  inputValue,
  onInputChange,
  scrollRef,
}: SkillChatCreatorProps) => {
  const isLoading = status === "sending" || status === "generating";
  const isDisabled = status !== "idle";

  const handleSend = () => {
    if (inputValue.trim() && !isDisabled) {
      onSendMessage(inputValue.trim());
    }
  };

  const handleSaveSkill = () => {
    if (generatedSkill) {
      onSaveSkill(generatedSkill);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h2 className="text-sm font-semibold">AI Skill Creator</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={messages.length === 0 && !error}
          className="gap-2"
        >
          <RefreshCw className="size-4" />
          New Conversation
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 pt-4">
          <ErrorBanner error={error} onDismiss={onClearError} />
        </div>
      )}

      {/* Messages area */}
      <ScrollArea className="flex-1 px-4">
        <div ref={scrollRef} className="py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bot className="size-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                Create a Skill with AI
              </h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Describe what kind of skill you want to create, and I will help
                you generate it. You can iterate on the result until you are
                satisfied.
              </p>
            </div>
          ) : (
            <>
              {messages.map((message, index) => {
                const isLastMessage = index === messages.length - 1;
                const isAssistantGenerating =
                  isLastMessage &&
                  message.role === "assistant" &&
                  status === "generating";

                return (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isGenerating={isAssistantGenerating}
                  />
                );
              })}
            </>
          )}

          {/* Generated skill preview */}
          {generatedSkill && (
            <div className="pt-2">
              <SkillPreviewCard
                skill={generatedSkill}
                onSave={handleSaveSkill}
              />
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="border-t px-4 py-4">
        <ChatInput
          value={inputValue}
          onChange={onInputChange}
          onSend={handleSend}
          disabled={isDisabled}
          isLoading={isLoading}
        />
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Press Ctrl+Enter to send
        </p>
      </div>
    </div>
  );
};
