// ---------------------------------------------------------------------------
// Feedback Widget - State Module (Singleton)
// ---------------------------------------------------------------------------
// Module-level mutable state managed through pure functions.
// The singleton is a plain object -- no classes, no `this`.
// ---------------------------------------------------------------------------

import type {
  BootstrapConfig,
  FeedbackWidgetConfig,
  WidgetState,
} from './types';

// ---------------------------------------------------------------------------
// Singleton state instance
// ---------------------------------------------------------------------------

const createInitialState = (): WidgetState => ({
  initialized: false,
  config: null,
  token: null,
  expiresAt: null,
  bootstrapConfig: null,
  isOpen: false,
  container: null,
});

let state: WidgetState = createInitialState();

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** Returns the entire internal state (read-only snapshot). */
export const getState = (): Readonly<WidgetState> => state;

/** Whether `init()` has been called and completed successfully. */
export const isInitialized = (): boolean => state.initialized;

/** Whether the widget modal is currently visible. */
export const isOpen = (): boolean => state.isOpen;

/** Returns the active configuration or `null` if not initialized. */
export const getConfig = (): Readonly<FeedbackWidgetConfig> | null => state.config;

/** Returns the current HMAC token or `null`. */
export const getToken = (): string | null => state.token;

/** Returns the bootstrap-provided configuration flags. */
export const getBootstrapConfig = (): Readonly<BootstrapConfig> | null => state.bootstrapConfig;

/** Returns the DOM container element, if mounted. */
export const getContainer = (): HTMLElement | null => state.container;

/**
 * Resolves the effective API base URL from config, stripping any trailing
 * slash.  Falls back to `window.location.origin`.
 */
export const getApiBaseUrl = (): string => {
  const raw = state.config?.apiBaseUrl ?? window.location.origin;
  return raw.replace(/\/+$/, '');
};

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the stored token is missing or has expired.
 * Adds a 30-second safety margin to avoid edge-case rejections.
 */
export const isTokenExpired = (): boolean => {
  if (!state.token || state.expiresAt === null) return true;
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec >= state.expiresAt - 30;
};

// ---------------------------------------------------------------------------
// Mutators
// ---------------------------------------------------------------------------

/** Marks the widget as fully initialized with the given config. */
export const setInitialized = (config: FeedbackWidgetConfig): void => {
  state.initialized = true;
  state.config = config;
};

/** Stores a freshly obtained bootstrap token and its expiry. */
export const setToken = (token: string, expiresAt: number): void => {
  state.token = token;
  state.expiresAt = expiresAt;
};

/** Persists the bootstrap configuration flags. */
export const setBootstrapConfig = (config: BootstrapConfig): void => {
  state.bootstrapConfig = config;
};

/** Marks the widget as open. */
export const setOpen = (): void => {
  state.isOpen = true;
};

/** Marks the widget as closed. */
export const setClosed = (): void => {
  state.isOpen = false;
};

/** Stores a reference to the widget's root DOM container. */
export const setContainer = (el: HTMLElement | null): void => {
  state.container = el;
};

/** Resets all state to the initial (uninitialized) values. */
export const resetState = (): void => {
  state = createInitialState();
};
