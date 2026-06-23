// ---------------------------------------------------------------------------
// Terminal Cleanup — handles job completion/failure thread lifecycle
//
// When a job reaches a terminal state (completed, failed, cancelled, timeout):
// 1. Finalizes any pending text/thinking messages
// 2. Edits the status (button) message to "Session ended."
// 3. Renames the Discord thread with a status prefix (✅ or ❌)
// ---------------------------------------------------------------------------

import type { DiscordRichChannelAdapter } from "@almirant/remote-agent";
import type { Logger } from "../platform/logger";
import { buildTerminalThreadName } from "./job-labels";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StatusMessage = {
  messageId: string;
  threadId: string;
};

type ThreadInfo = {
  threadId: string;
  name: string;
};

export type TerminalCleanupDeps = {
  adapter: DiscordRichChannelAdapter;
  log: Logger;
  getStatusMessage: (jobId: string) => StatusMessage | undefined;
  getThreadInfo: (jobId: string) => ThreadInfo | undefined;
  markTerminated: (jobId: string) => void;
  deleteStatusMessage: (jobId: string) => void;
  deleteThreadInfo: (jobId: string) => void;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export type TerminalCleaner = {
  /** Run terminal cleanup for a job. */
  cleanup: (jobId: string, status?: "completed" | "incomplete" | "failed") => Promise<void>;
};

export const createTerminalCleaner = (deps: TerminalCleanupDeps): TerminalCleaner => {
  const { adapter, log, getStatusMessage, getThreadInfo, markTerminated, deleteStatusMessage, deleteThreadInfo } = deps;

  return {
    cleanup: async (jobId: string, status: "completed" | "incomplete" | "failed" = "completed"): Promise<void> => {
      markTerminated(jobId);

      // Edit status message to "Session ended."
      const tracked = getStatusMessage(jobId);
      if (tracked) {
        try {
          await adapter.editRichMessage(tracked.threadId, tracked.messageId, {
            content: "\u{2705} Session ended.",
            components: [],
          });
        } catch {
          // Best-effort cleanup.
        }
        deleteStatusMessage(jobId);
      }

      // Rename the thread with status prefix
      const threadInfo = getThreadInfo(jobId);
      if (threadInfo) {
        const newName = buildTerminalThreadName(threadInfo.name, status);
        try {
          await adapter.renameThread(threadInfo.threadId, newName);
        } catch (error) {
          log("warn", `Failed to rename thread on ${status}`, {
            jobId,
            threadId: threadInfo.threadId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        deleteThreadInfo(jobId);
      }
    },
  };
};
