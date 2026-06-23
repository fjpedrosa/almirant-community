// ---------------------------------------------------------------------------
// Text Accumulator — manages pending text content and flush to Discord
//
// Text events are accumulated in memory and flushed to Discord when:
// 1. A non-text event arrives (tool call, step, thinking, completion, etc.)
// 2. The safety-net timer fires (TEXT_SAFETY_FLUSH_MS of silence)
// 3. The accumulated text exceeds TEXT_SPLIT_THRESHOLD
// ---------------------------------------------------------------------------

import { sanitizeForDiscord } from "../platform/log-sanitizer";
import {
  convertTablesToCodeBlocks,
  truncate,
  MAX_MESSAGE_LENGTH,
  TEXT_SPLIT_THRESHOLD,
} from "./content-transform";

const TEXT_SAFETY_FLUSH_MS = 30_000;

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

export type TextAccumulator = {
  /** Accumulate text content (deferred send). */
  accumulate: (jobId: string, threadId: string, content: string) => void;
  /** Flush pending text to Discord immediately. */
  flush: (jobId: string) => Promise<void>;
  /** Finalize the current text message (move to lastTextContent). */
  finalize: (jobId: string) => void;
  /** Get the last finalized text content for a job (used for completion summary). */
  getLastTextContent: (jobId: string) => { messageId: string; threadId: string; content: string } | undefined;
  /** Check if a job has an active text message being edited. */
  hasActiveMessage: (jobId: string) => boolean;
  /** Cleanup all state for a job. */
  cleanup: (jobId: string) => void;
};

export const createTextAccumulator = (ops: DiscordOps): TextAccumulator => {
  const activeTextMessages = new Map<string, TrackedMessage>();
  const pendingTextContent = new Map<string, { threadId: string; content: string }>();
  const lastTextContent = new Map<string, { messageId: string; threadId: string; content: string }>();
  const textFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const finalize = (jobId: string): void => {
    const tracked = activeTextMessages.get(jobId);
    if (tracked) {
      lastTextContent.set(jobId, {
        messageId: tracked.messageId,
        threadId: tracked.threadId,
        content: tracked.content,
      });
    }
    activeTextMessages.delete(jobId);
  };

  const flush = async (jobId: string): Promise<void> => {
    const timer = textFlushTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      textFlushTimers.delete(jobId);
    }
    const pending = pendingTextContent.get(jobId);
    if (!pending) return;
    pendingTextContent.delete(jobId);

    const content = convertTablesToCodeBlocks(sanitizeForDiscord(pending.content));
    if (!content.trim()) return;

    const existing = activeTextMessages.get(jobId);
    if (!existing) {
      const messageId = await ops.sendRichAndTrack(pending.threadId, content, "render-text-new");
      activeTextMessages.set(jobId, { messageId, threadId: pending.threadId, content });
      await ops.repinButtons(jobId, pending.threadId);
    } else {
      const accumulated = existing.content + content;
      if (accumulated.length > TEXT_SPLIT_THRESHOLD) {
        finalize(jobId);
        const messageId = await ops.sendRichAndTrack(pending.threadId, content, "render-text-split");
        activeTextMessages.set(jobId, { messageId, threadId: pending.threadId, content });
        await ops.repinButtons(jobId, pending.threadId);
      } else {
        existing.content = accumulated;
        await ops.editMessage(existing.threadId, existing.messageId, accumulated, "render-text-edit");
      }
    }
  };

  return {
    accumulate: (jobId: string, threadId: string, content: string): void => {
      const pending = pendingTextContent.get(jobId);
      if (pending) {
        pending.content += content;
      } else {
        pendingTextContent.set(jobId, { threadId, content });
      }

      // Safety-net: flush if no non-text event arrives within the window
      const existingTimer = textFlushTimers.get(jobId);
      if (!existingTimer) {
        textFlushTimers.set(jobId, setTimeout(() => {
          textFlushTimers.delete(jobId);
          void flush(jobId);
        }, TEXT_SAFETY_FLUSH_MS));
      }
    },

    flush,
    finalize,

    getLastTextContent: (jobId: string) => lastTextContent.get(jobId),

    hasActiveMessage: (jobId: string) => activeTextMessages.has(jobId),

    cleanup: (jobId: string): void => {
      activeTextMessages.delete(jobId);
      pendingTextContent.delete(jobId);
      lastTextContent.delete(jobId);
      const timer = textFlushTimers.get(jobId);
      if (timer) clearTimeout(timer);
      textFlushTimers.delete(jobId);
    },
  };
};
