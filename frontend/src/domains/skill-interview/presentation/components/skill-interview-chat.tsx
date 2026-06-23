import { Loader2, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { cn } from "@/lib/utils";
import { SkillPreview } from "./skill-preview";
import type { SkillInterviewChatProps } from "../../domain/types";

const TypingIndicator = () => (
  <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
    <Loader2 className="size-4 animate-spin" />
    Crafting the next response...
  </div>
);

export const SkillInterviewChat: React.FC<SkillInterviewChatProps> = ({
  messages,
  draftMessage,
  onDraftMessageChange,
  onSendMessage,
  isStreaming,
  error,
  generatedSkill,
  onBackToChat,
  onCopySkill,
  onDownloadSkill,
  hasCopiedSkill,
}) => {
  if (generatedSkill) {
    return (
      <SkillPreview
        skill={generatedSkill}
        onBackToChat={onBackToChat}
        onCopySkill={onCopySkill}
        onDownloadSkill={onDownloadSkill}
        hasCopiedSkill={hasCopiedSkill}
      />
    );
  }

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-[2rem] border border-border bg-[radial-gradient(circle_at_top,_rgba(15,118,110,0.12),_transparent_38%),linear-gradient(180deg,_rgba(248,250,252,0.96),_rgba(241,245,249,0.96))]">
      <div className="border-b border-border/80 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Skill Interview
            </h1>
            <p className="text-sm text-muted-foreground">
              Describe the workflow you want, and the assistant will interview
              you until it can produce a complete <code>SKILL.md</code>.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="mx-auto flex max-w-3xl flex-col gap-5 rounded-[2rem] border border-dashed border-primary/25 bg-background/80 p-8 shadow-sm">
            <div className="flex items-center gap-3 text-primary">
              <WandSparkles className="size-5" />
              <span className="text-sm font-semibold uppercase tracking-[0.2em]">
                Interview starter
              </span>
            </div>
            <div className="space-y-3 text-sm leading-6 text-muted-foreground">
              <p>Useful details to provide in the first message:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>What the skill should help the agent accomplish</li>
                <li>What triggers or situations should activate it</li>
                <li>Any repo rules, tools, or output format expectations</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {messages.map((message) => {
              const isAssistant = message.role === "assistant";

              return (
                <article
                  key={message.id}
                  className={cn(
                    "flex",
                    isAssistant ? "justify-start" : "justify-end",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-3xl rounded-[1.75rem] border px-5 py-4 shadow-sm",
                      isAssistant
                        ? "border-border bg-card"
                        : "border-primary/20 bg-primary text-primary-foreground",
                    )}
                  >
                    {isAssistant ? (
                      message.content ? (
                        <MarkdownPreview content={message.content} size="sm" />
                      ) : (
                        <TypingIndicator />
                      )
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        {message.content}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}

            {isStreaming && messages[messages.length - 1]?.role !== "assistant" ? (
              <TypingIndicator />
            ) : null}
          </div>
        )}
      </div>

      <div className="border-t border-border/80 bg-background/80 px-6 py-5">
        <div className="mx-auto flex max-w-4xl flex-col gap-3">
          {error ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <Textarea
            value={draftMessage}
            onChange={(event) => onDraftMessageChange(event.target.value)}
            placeholder="Explain the skill you want to create..."
            className="min-h-28 resize-none rounded-[1.5rem] border-border bg-background px-4 py-3 text-base"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void onSendMessage();
              }
            }}
          />

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Press <kbd className="rounded bg-muted px-1.5 py-0.5">Ctrl</kbd> +{" "}
              <kbd className="rounded bg-muted px-1.5 py-0.5">Enter</kbd> to
              send.
            </p>
            <Button
              type="button"
              onClick={() => void onSendMessage()}
              disabled={isStreaming || !draftMessage.trim()}
              className="rounded-full px-5"
            >
              {isStreaming ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Streaming...
                </>
              ) : (
                "Send message"
              )}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};
