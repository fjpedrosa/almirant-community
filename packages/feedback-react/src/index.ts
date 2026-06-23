// ---------------------------------------------------------------------------
// @almirant/feedback-react - React adapter for the feedback widget
// ---------------------------------------------------------------------------
//
// Usage:
//   import { useFeedbackWidget, FeedbackWidget } from '@almirant/feedback-react';
//
//   // Hook usage
//   const { open, close, submit, isReady, isOpen, error } = useFeedbackWidget({
//     publicKey: 'pk_...',
//   });
//
//   // Component usage (renders nothing, just initializes the widget)
//   <FeedbackWidget publicKey="pk_..." onSubmitSuccess={(d) => console.log(d.id)} />
// ---------------------------------------------------------------------------

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  init,
  open as widgetOpen,
  close as widgetClose,
  destroy as widgetDestroy,
  submit as widgetSubmit,
  isOpen as widgetIsOpen,
} from '../../feedback-widget/src/index';
import type { FeedbackWidgetConfig } from '../../feedback-widget/src/types';

// Re-export all types from the base widget so consumers do not need to depend
// on `@almirant/feedback-widget` directly.
export type {
  FeedbackWidgetConfig,
  WidgetPosition,
  WidgetTheme,
  SubmitSuccessPayload,
  BootstrapData,
  BootstrapConfig,
  IngestPayload,
  IngestResultData,
} from '../../feedback-widget/src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compares two configs by identity keys to detect meaningful changes. */
const configChanged = (
  prev: FeedbackWidgetConfig | null,
  next: FeedbackWidgetConfig,
): boolean => {
  if (!prev) return true;
  return prev.publicKey !== next.publicKey || prev.apiBaseUrl !== next.apiBaseUrl;
};

// ---------------------------------------------------------------------------
// useFeedbackWidget hook
// ---------------------------------------------------------------------------

interface UseFeedbackWidgetReturn {
  /** Opens the widget modal. No-op if not yet ready. */
  open: () => Promise<void>;
  /** Closes the widget modal. */
  close: () => void;
  /** Programmatically submits feedback. */
  submit: (params: {
    message: string;
    category?: string;
    email?: string;
    pageUrl?: string;
    captchaToken?: string;
  }) => Promise<{ id: string; status: string; createdAt: string }>;
  /** `true` once `init()` has completed successfully. */
  isReady: boolean;
  /** `true` while the widget modal is visible. */
  isOpen: boolean;
  /** The error if `init()` failed; `null` otherwise. */
  error: Error | null;
}

/**
 * React hook that manages the full lifecycle of the feedback widget.
 *
 * - Calls `init()` on mount and `destroy()` on unmount.
 * - Re-initializes when `publicKey` or `apiBaseUrl` change.
 * - Handles React 18/19 StrictMode double-mount safely via a ref guard.
 * - SSR-safe: skips initialization when `window` is unavailable.
 *
 * @param config - Widget configuration. Only `publicKey` is required.
 */
export const useFeedbackWidget = (
  config: FeedbackWidgetConfig,
): UseFeedbackWidgetReturn => {
  const [isReady, setIsReady] = useState(false);
  const [isOpenState, setIsOpenState] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Ref tracking the config that was used for the active initialization.
  // Enables detecting meaningful changes (publicKey/apiBaseUrl) without
  // re-running the effect on every render.
  const activeConfigRef = useRef<FeedbackWidgetConfig | null>(null);

  // Guard against StrictMode double-invocation: only the effect instance whose
  // `mounted` flag is still `true` at resolution time should mutate state.
  const mountedRef = useRef(false);

  // Generation counter to handle StrictMode and rapid navigation race conditions.
  // Each new init attempt increments this. When an async init resolves, it checks
  // whether it is still the latest generation before touching state or DOM.
  const generationRef = useRef(0);

  // Memoized initialization function. We define it once and call it from the
  // effect so the identity is stable.
  const initialize = useCallback(async (cfg: FeedbackWidgetConfig, mounted: { current: boolean }) => {
    // SSR guard
    if (typeof window === 'undefined') return;

    // Claim a generation slot. If another init starts (StrictMode remount,
    // config change), that call will bump the generation and this one will
    // become stale.
    const myGeneration = ++generationRef.current;

    try {
      // Destroy previous instance if one exists (config change scenario).
      try {
        widgetDestroy();
      } catch {
        // Ignore -- destroy is a no-op if not initialized.
      }

      await init(cfg);

      // Stale check: if the generation has moved on (another init or cleanup
      // incremented it), this call lost the race. Do NOT call widgetDestroy()
      // here -- the winning generation may already own the singleton state.
      // The winning init() defensively removes orphaned containers via the
      // getElementById guard in the base widget.
      if (myGeneration !== generationRef.current) {
        return;
      }

      // Only update React state if this effect instance is still mounted.
      if (mounted.current) {
        activeConfigRef.current = cfg;
        setIsReady(true);
        setError(null);
      } else {
        // Component unmounted while we were awaiting -- clean up immediately.
        try { widgetDestroy(); } catch { /* safe */ }
      }
    } catch (err) {
      // Only set error if this is still the latest generation and mounted.
      if (myGeneration === generationRef.current && mounted.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsReady(false);
      }
    }
  }, []);

  // Primary lifecycle effect: init on mount, destroy on unmount, re-init on
  // meaningful config changes.
  useEffect(() => {
    const mounted = { current: true };
    mountedRef.current = true;

    // Determine if we should (re-)initialize.
    const needsInit = configChanged(activeConfigRef.current, config);

    if (needsInit) {
      void initialize(config, mounted);
    }

    return () => {
      mounted.current = false;
      mountedRef.current = false;

      // Invalidate any in-flight init so its post-await code becomes a no-op.
      generationRef.current++;

      // Tear down the widget to prevent DOM leaks.
      try {
        widgetDestroy();
      } catch {
        // Safe to ignore.
      }
      activeConfigRef.current = null;
    };
    // We intentionally depend on identity keys only, not the full config object,
    // so that callback changes (onOpen, onClose, etc.) do not cause a full
    // destroy + re-init cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.publicKey, config.apiBaseUrl, initialize]);

  // --- Exposed actions ---

  const open = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;
    await widgetOpen();
    if (mountedRef.current) setIsOpenState(true);
  }, []);

  const close = useCallback((): void => {
    widgetClose();
    if (mountedRef.current) setIsOpenState(false);
  }, []);

  const submit = useCallback(
    async (params: {
      message: string;
      category?: string;
      email?: string;
      pageUrl?: string;
      captchaToken?: string;
    }) => {
      return widgetSubmit(params);
    },
    [],
  );

  // Sync the `isOpen` state with the widget's actual state when the consumer
  // reads it. This covers cases where the widget was opened/closed externally.
  const derivedIsOpen = isReady ? widgetIsOpen() : isOpenState;

  return {
    open,
    close,
    submit,
    isReady,
    isOpen: derivedIsOpen,
    error,
  };
};

// ---------------------------------------------------------------------------
// FeedbackWidget component
// ---------------------------------------------------------------------------

/**
 * Convenience component that initializes the feedback widget without rendering
 * any visible DOM. Drop it into your layout and the widget will be available
 * globally.
 *
 * ```tsx
 * <FeedbackWidget
 *   publicKey="pk_..."
 *   apiBaseUrl="https://api.example.com"
 *   position="bottom-right"
 *   theme="auto"
 *   onSubmitSuccess={(data) => console.log('Sent:', data.id)}
 * />
 * ```
 */
export const FeedbackWidget = (props: FeedbackWidgetConfig): null => {
  useFeedbackWidget(props);
  return null;
};
