// ---------------------------------------------------------------------------
// Thinking Accumulator — manages thinking block accumulation for Discord
//
// Thinking content is accumulated in memory and only sent to Discord when
// the block completes (next non-thinking event) or when the accumulated
// content exceeds the split threshold.
// ---------------------------------------------------------------------------

import { formatThinkingBlock } from "@almirant/remote-agent";
import { TEXT_SPLIT_THRESHOLD } from "./content-transform";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TrackedMessage = {
  messageId: string;
  threadId: string;
  content: string;
};

type DiscordOps = {
  sendRichAndTrack: (threadId: string, content: string, label: string) => Promise<string>;
  editMessage: (threadId: string, messageId: string, content: string, label: string) => Promise<void>;
  repinButtons: (jobId: string, threadId: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type ThinkingAccumulator = {
  /** Accumulate thinking content (deferred send). */
  accumulate: (jobId: string, threadId: string, content: string) => Promise<void>;
  /** Finalize thinking: send any unsent content to Discord and clear state. */
  finalize: (jobId: string) => Promise<void>;
  /** Check if a job has accumulated thinking content. */
  hasContent: (jobId: string) => boolean;
  /** Cleanup all state for a job. */
  cleanup: (jobId: string) => void;
};

export const createThinkingAccumulator = (ops: DiscordOps): ThinkingAccumulator => {
  const activeThinkingMessages = new Map<string, TrackedMessage>();

  const finalize = async (jobId: string): Promise<void> => {
    const tracked = activeThinkingMessages.get(jobId);
    if (tracked && tracked.content.trim()) {
      if (!tracked.messageId) {
        const formatted = formatThinkingBlock(tracked.content);
        await ops.sendRichAndTrack(tracked.threadId, formatted, "render-thinking-finalize");
        await ops.repinButtons(jobId, tracked.threadId);
      } else {
        const formatted = formatThinkingBlock(tracked.content);
        await ops.editMessage(tracked.threadId, tracked.messageId, formatted, "render-thinking-finalize-edit");
      }
    }
    activeThinkingMessages.delete(jobId);
  };

  return {
    accumulate: async (jobId: string, threadId: string, content: string): Promise<void> => {
      const existing = activeThinkingMessages.get(jobId);

      if (!existing) {
        activeThinkingMessages.set(jobId, {
          messageId: "",
          threadId,
          content,
        });
        return;
      }

      const accumulated = existing.content + content;

      if (accumulated.length > TEXT_SPLIT_THRESHOLD) {
        if (!existing.messageId) {
          const formatted = formatThinkingBlock(existing.content);
          await ops.sendRichAndTrack(threadId, formatted, "render-thinking-block");
        } else {
          const formatted = formatThinkingBlock(existing.content);
          await ops.editMessage(existing.threadId, existing.messageId, formatted, "render-thinking-block-edit");
        }
        await finalize(jobId);
        activeThinkingMessages.set(jobId, {
          messageId: "",
          threadId,
          content,
        });
        return;
      }

      existing.content = accumulated;
    },

    finalize,

    hasContent: (jobId: string) => activeThinkingMessages.has(jobId),

    cleanup: (jobId: string): void => {
      activeThinkingMessages.delete(jobId);
    },
  };
};
