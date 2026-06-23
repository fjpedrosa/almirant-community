import type { BootstrapConfig, FeedbackWidgetConfig, WidgetState } from './types';
/** Returns the entire internal state (read-only snapshot). */
export declare const getState: () => Readonly<WidgetState>;
/** Whether `init()` has been called and completed successfully. */
export declare const isInitialized: () => boolean;
/** Whether the widget modal is currently visible. */
export declare const isOpen: () => boolean;
/** Returns the active configuration or `null` if not initialized. */
export declare const getConfig: () => Readonly<FeedbackWidgetConfig> | null;
/** Returns the current HMAC token or `null`. */
export declare const getToken: () => string | null;
/** Returns the bootstrap-provided configuration flags. */
export declare const getBootstrapConfig: () => Readonly<BootstrapConfig> | null;
/** Returns the DOM container element, if mounted. */
export declare const getContainer: () => HTMLElement | null;
/**
 * Resolves the effective API base URL from config, stripping any trailing
 * slash.  Falls back to `window.location.origin`.
 */
export declare const getApiBaseUrl: () => string;
/**
 * Returns `true` when the stored token is missing or has expired.
 * Adds a 30-second safety margin to avoid edge-case rejections.
 */
export declare const isTokenExpired: () => boolean;
/** Marks the widget as fully initialized with the given config. */
export declare const setInitialized: (config: FeedbackWidgetConfig) => void;
/** Stores a freshly obtained bootstrap token and its expiry. */
export declare const setToken: (token: string, expiresAt: number) => void;
/** Persists the bootstrap configuration flags. */
export declare const setBootstrapConfig: (config: BootstrapConfig) => void;
/** Marks the widget as open. */
export declare const setOpen: () => void;
/** Marks the widget as closed. */
export declare const setClosed: () => void;
/** Stores a reference to the widget's root DOM container. */
export declare const setContainer: (el: HTMLElement | null) => void;
/** Resets all state to the initial (uninitialized) values. */
export declare const resetState: () => void;
