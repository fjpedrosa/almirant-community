export type ThrottledContentUpdater = (content: string) => Promise<void>;

export type ThrottleController = {
  schedule: (content: string) => void;
  flush: () => Promise<void>;
  stop: () => Promise<void>;
  getLastSentContent: () => string | null;
};

export const createThrottleController = (
  updater: ThrottledContentUpdater,
  intervalMs = 1000
): ThrottleController => {
  let pending: string | null = null;
  let lastSent: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;
  let stopped = false;

  const flushInternal = async (): Promise<void> => {
    if (flushing || pending === null || stopped) {
      return;
    }

    if (pending === lastSent) {
      pending = null;
      return;
    }

    flushing = true;
    const nextContent = pending;
    pending = null;

    try {
      await updater(nextContent);
      lastSent = nextContent;
    } finally {
      flushing = false;
      if (pending !== null && !stopped) {
        timer = setTimeout(() => {
          void flushInternal();
        }, intervalMs);
      }
    }
  };

  return {
    schedule: (content: string) => {
      if (stopped) return;
      pending = content;
      if (timer) return;

      timer = setTimeout(() => {
        timer = null;
        void flushInternal();
      }, intervalMs);
    },
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flushInternal();
    },
    stop: async () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flushInternal();
    },
    getLastSentContent: () => lastSent,
  };
};
