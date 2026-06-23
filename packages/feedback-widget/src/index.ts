// ---------------------------------------------------------------------------
// Feedback Widget - Public API
// ---------------------------------------------------------------------------
// Entry point for `@almirant/feedback-widget`.
//
// Usage (ESM):
//   import { init, open, close, destroy } from '@almirant/feedback-widget';
//   await init({ publicKey: 'pk_...' });
//   open();
//
// Usage (script tag / IIFE):
//   <script src="feedback-widget.iife.js"></script>
//   <script>
//     FeedbackWidget.init({ publicKey: 'pk_...' }).then(() => {
//       FeedbackWidget.open();
//     });
//   </script>
// ---------------------------------------------------------------------------

import { bootstrapWidget, submitFeedback } from './api';
import {
  getApiBaseUrl,
  getConfig,
  getContainer,
  getToken,
  getBootstrapConfig,
  isInitialized,
  isOpen,
  isTokenExpired,
  resetState,
  setBootstrapConfig,
  setClosed,
  setContainer,
  setInitialized,
  setOpen,
  setToken,
} from './state';
import type { FeedbackWidgetConfig, IngestPayload } from './types';
import { renderUI, showModal, hideModal, destroyUI } from './ui/widget-ui';

// Re-export types so consumers can reference them without a deep import.
export type {
  FeedbackWidgetConfig,
  WidgetPosition,
  WidgetTheme,
  SubmitSuccessPayload,
  BootstrapData,
  BootstrapConfig,
  IngestPayload,
  IngestResultData,
} from './types';

// Re-export API helpers for advanced / programmatic usage (e.g., Wave 2 form
// submission hook).
export { bootstrapWidget, submitFeedback } from './api';

// Re-export state accessors so the UI layer (separate package / task) can read
// widget state without duplicating it.
export {
  getApiBaseUrl,
  getConfig,
  getContainer,
  getToken,
  getBootstrapConfig,
  isInitialized,
  isOpen,
  isTokenExpired,
} from './state';

// ---------------------------------------------------------------------------
// Internal: bootstrap or refresh the token
// ---------------------------------------------------------------------------

/**
 * Performs the bootstrap call and stores the resulting token + config.
 * Shared between `init()` (first call) and `open()` (token refresh).
 */
const performBootstrap = async (): Promise<void> => {
  const config = getConfig();
  if (!config) {
    throw new Error('FeedbackWidget: cannot bootstrap before init()');
  }

  const apiBaseUrl = getApiBaseUrl();
  const data = await bootstrapWidget(apiBaseUrl, config.publicKey);

  setToken(data.token, data.expiresAt);
  setBootstrapConfig(data.config);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initializes the feedback widget.
 *
 * Calls the bootstrap endpoint to obtain a short-lived token and validates
 * the public key.  Must be called once before `open()`.
 *
 * @param config - Widget configuration. Only `publicKey` is required.
 * @throws {Error} If already initialized, or if the bootstrap call fails.
 */
export const init = async (config: FeedbackWidgetConfig): Promise<void> => {
  if (isInitialized()) {
    throw new Error('FeedbackWidget: already initialized. Call destroy() first.');
  }

  // Store config early so `getApiBaseUrl()` works inside `performBootstrap`.
  setInitialized(config);

  try {
    await performBootstrap();
  } catch (err) {
    // Roll back so the consumer can retry.
    resetState();
    throw err;
  }

  // Create a root container element for the widget UI.
  if (typeof document !== 'undefined') {
    // Defensively remove any orphaned container from a previous init cycle
    // (e.g. StrictMode unmount/remount or rapid navigation).
    const orphaned = document.getElementById('feedback-widget-root');
    if (orphaned?.parentNode) {
      orphaned.parentNode.removeChild(orphaned);
    }

    const container = document.createElement('div');
    container.id = 'feedback-widget-root';
    container.setAttribute('data-feedback-widget', 'true');
    document.body.appendChild(container);
    setContainer(container);

    // Render the UI (trigger button + modal) inside the container.
    renderUI(
      container,
      config,
      () => { open(); },
      () => { close(); },
      async (data) => {
        await submit({
          message: data.message,
          category: data.category,
          email: data.email,
        });
      },
    );
  }
};

/**
 * Opens the feedback widget modal.
 *
 * If the stored token has expired, a transparent re-bootstrap is attempted
 * before opening.
 *
 * @throws {Error} If the widget has not been initialized.
 */
export const open = async (): Promise<void> => {
  if (!isInitialized()) {
    throw new Error('FeedbackWidget: not initialized. Call init() first.');
  }

  // Transparently refresh an expired token.
  if (isTokenExpired()) {
    await performBootstrap();
  }

  setOpen();
  showModal();

  const config = getConfig();
  config?.onOpen?.();
};

/**
 * Closes the feedback widget modal.
 *
 * No-op if the widget is already closed.
 */
export const close = (): void => {
  if (!isOpen()) return;

  setClosed();
  hideModal();

  const config = getConfig();
  config?.onClose?.();
};

/**
 * Tears down the widget completely.
 *
 * Removes the DOM container and resets all internal state so `init()` can
 * be called again.
 */
export const destroy = (): void => {
  // Close first (fires onClose if open).
  if (isOpen()) {
    close();
  }

  // Tear down UI elements before removing the container.
  destroyUI();

  // Remove DOM container.
  const container = getContainer();
  if (container?.parentNode) {
    container.parentNode.removeChild(container);
  }

  resetState();
};

/**
 * Programmatically submits feedback.
 *
 * Exposed for consumers that build their own UI and only need the transport
 * layer (token management + API call).
 *
 * @param params          - Feedback content.
 * @param params.message  - The feedback message (1-5000 chars).
 * @param params.category - Optional category string.
 * @param params.email    - Optional author email.
 * @param params.pageUrl  - Optional URL of the page where feedback was given.
 * @param params.captchaToken - Optional hCaptcha token if required.
 * @returns The created feedback item metadata.
 * @throws {Error} If not initialized, or if the API call fails.
 */
export const submit = async (params: {
  message: string;
  category?: string;
  email?: string;
  pageUrl?: string;
  captchaToken?: string;
}): Promise<{ id: string; status: string; createdAt: string }> => {
  if (!isInitialized()) {
    throw new Error('FeedbackWidget: not initialized. Call init() first.');
  }

  // Ensure a valid token.
  if (isTokenExpired()) {
    await performBootstrap();
  }

  const config = getConfig();
  const token = getToken();

  if (!config || !token) {
    throw new Error('FeedbackWidget: missing config or token after bootstrap.');
  }

  const payload: IngestPayload = {
    publicKey: config.publicKey,
    token,
    message: params.message,
    category: params.category,
    email: params.email,
    pageUrl: params.pageUrl ?? (typeof window !== 'undefined' ? window.location.href : undefined),
    locale: config.locale,
    captchaToken: params.captchaToken,
  };

  const apiBaseUrl = getApiBaseUrl();

  try {
    const result = await submitFeedback(apiBaseUrl, payload);
    config.onSubmitSuccess?.({ id: result.id });
    return result;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    config.onSubmitError?.(error);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Default export -- convenient for IIFE / script-tag consumers where the
// bundler maps the namespace to `window.FeedbackWidget`.
// ---------------------------------------------------------------------------

const FeedbackWidget = {
  init,
  open,
  close,
  destroy,
  submit,
  /** Low-level API helpers. */
  api: { bootstrapWidget, submitFeedback },
  /** State accessors. */
  state: {
    getConfig,
    getToken,
    getBootstrapConfig,
    getApiBaseUrl,
    getContainer,
    isInitialized,
    isOpen,
    isTokenExpired,
  },
} as const;

export default FeedbackWidget;
