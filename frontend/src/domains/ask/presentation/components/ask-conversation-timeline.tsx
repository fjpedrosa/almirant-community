"use client";

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type ComponentType,
} from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { ConversationMessage } from "@/domains/shared/presentation/components/conversation-message";
import type { ConversationMessage as ConversationMessageType } from "@/domains/shared/domain/conversation-types";
import type { QuickFeedbackData } from "@/domains/shared/domain/conversation-types";
import type { AskConfidenceLevel, AskCitation } from "../../domain/types";
import { linkifyCitations } from "../../application/utils/linkify-citations";
import { AskConfidenceBadge } from "./ask-confidence-badge";
import { AskCitationsCollapsible } from "./ask-citations-collapsible";

// ---------------------------------------------------------------------------
// Component: AskConversationTimeline
// ---------------------------------------------------------------------------

export interface AskConversationTimelineProps {
  messages: ConversationMessageType[];
  isLoading: boolean;
  onFeedback?: (messageId: string, data: QuickFeedbackData) => void;
}

// Builds a custom markdown `a` component that makes citation [N] references
// clickable. Real URLs open in a new tab; #ask-cite-N anchors expand the
// citations collapsible.
const buildCitationLink = (
  onCiteClick: (index: number) => void
): ComponentType<Record<string, unknown>> => {
  const CitationLink: ComponentType<Record<string, unknown>> = (props) => {
    const { href, children, ...rest } = props as {
      href?: string;
      children?: React.ReactNode;
      [key: string]: unknown;
    };

    if (!href) {
      return <span {...rest}>{children}</span>;
    }

    // Internal citation anchor — click to expand citations section
    if (href.startsWith("#ask-cite-")) {
      const idx = parseInt(href.replace("#ask-cite-", ""), 10);
      return (
        <button
          type="button"
          onClick={() => onCiteClick(idx)}
          className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors cursor-pointer tabular-nums align-baseline"
        >
          {children}
        </button>
      );
    }

    // Real URL — open in new tab
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors no-underline tabular-nums align-baseline"
      >
        {children}
      </a>
    );
  };
  CitationLink.displayName = "CitationLink";
  return CitationLink;
};

export const AskConversationTimeline: React.FC<
  AskConversationTimelineProps
> = ({ messages, isLoading, onFeedback }) => {
  const t = useTranslations("ask");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Track which message's citations collapsible is open
  const [openCitationsId, setOpenCitationsId] = useState<string | null>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isLoading]);

  return (
    <div className="flex flex-col gap-4 p-4 px-6 md:px-4 max-w-3xl mx-auto w-full mt-auto">
      {messages.map((message, index) => {
        const isLastMessage = index === messages.length - 1;
        const isAssistant = message.role === "assistant";
        const metadata = message.metadata ?? {};
        const confidenceLevel = metadata.confidenceLevel as
          | AskConfidenceLevel
          | undefined;
        const citations =
          (metadata.citations as AskCitation[] | undefined) ?? [];
        const isAbstention = Boolean(metadata.isAbstention);
        const isError = Boolean(metadata.isError);

        // Linkify citation references [N] in assistant content
        const displayContent =
          isAssistant && citations.length > 0
            ? linkifyCitations(message.content, citations)
            : message.content;

        // Loading state: show spinner
        if (
          isAssistant &&
          message.deliveryStatus === "processing" &&
          !message.content
        ) {
          return (
            <div key={message.id} className="flex items-start gap-3 w-full">
              <div className="rounded-2xl bg-muted/50 border border-border/40 px-4 py-3 flex items-center gap-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {t("response.thinking")}
                </span>
              </div>
            </div>
          );
        }

        return (
          <AskMessageBlock
            key={message.id}
            message={message}
            displayContent={displayContent}
            isLastMessage={isLastMessage}
            isAssistant={isAssistant}
            isError={isError}
            isAbstention={isAbstention}
            confidenceLevel={confidenceLevel}
            citations={citations}
            isCollapsibleOpen={openCitationsId === message.id}
            onToggleCollapsible={() =>
              setOpenCitationsId((prev) =>
                prev === message.id ? null : message.id
              )
            }
            onFeedback={onFeedback}
            thinkingLabel={t("thinking")}
          />
        );
      })}

      {/* Loading indicator for new message being processed */}
      {isLoading && messages.length === 0 && (
        <div className="flex items-start gap-3 w-full">
          <div className="rounded-2xl bg-muted/50 border border-border/40 px-4 py-3 flex items-center gap-2">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {t("response.thinking")}
            </span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-component: AskMessageBlock
// ---------------------------------------------------------------------------
// Renders a single message with its Ask-specific extras (confidence badge,
// citations collapsible). Memoizes the citation link component so it doesn't
// re-create on every render.
// ---------------------------------------------------------------------------

interface AskMessageBlockProps {
  message: ConversationMessageType;
  displayContent: string;
  isLastMessage: boolean;
  isAssistant: boolean;
  isError: boolean;
  isAbstention: boolean;
  confidenceLevel: AskConfidenceLevel | undefined;
  citations: AskCitation[];
  isCollapsibleOpen: boolean;
  onToggleCollapsible: () => void;
  onFeedback?: (messageId: string, data: QuickFeedbackData) => void;
  thinkingLabel: string;
}

const AskMessageBlock: React.FC<AskMessageBlockProps> = ({
  message,
  displayContent,
  isLastMessage,
  isAssistant,
  isError,
  isAbstention,
  confidenceLevel,
  citations,
  isCollapsibleOpen,
  onToggleCollapsible,
  onFeedback,
  thinkingLabel,
}) => {
  // When a [N] anchor is clicked, expand the collapsible
  const handleCiteClick = useCallback(
    (_index: number) => {
      if (!isCollapsibleOpen) {
        onToggleCollapsible();
      }
    },
    [isCollapsibleOpen, onToggleCollapsible]
  );

  // Build markdown components with the cite click handler
  const markdownComponents = useCallback(() => {
    if (!isAssistant || citations.length === 0) return undefined;
    return { a: buildCitationLink(handleCiteClick) };
  }, [isAssistant, citations.length, handleCiteClick])();

  return (
    <div className="flex flex-col gap-1">
      <ConversationMessage
        role={message.role}
        content={displayContent}
        timestamp={message.timestamp}
        isLastMessage={isLastMessage}
        deliveryStatus={message.deliveryStatus}
        messageId={message.id}
        onFeedback={onFeedback}
        markdownComponents={markdownComponents}
        labels={{
          thinking: thinkingLabel,
        }}
      />

      {/* Ask-specific extras for assistant messages */}
      {isAssistant && !isError && message.content && (
        <div className="pl-0 flex flex-col gap-1.5">
          {confidenceLevel && !isAbstention && (
            <div className="flex items-center gap-2 ml-1">
              <AskConfidenceBadge confidenceLevel={confidenceLevel} />
            </div>
          )}
          {citations.length > 0 && (
            <div className="ml-1">
              <AskCitationsCollapsible
                citations={citations}
                isOpen={isCollapsibleOpen}
                onToggle={onToggleCollapsible}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
