import type { FeedbackWidgetConfig, IngestPayload } from './types';
export type { FeedbackWidgetConfig, WidgetPosition, WidgetTheme, SubmitSuccessPayload, BootstrapData, BootstrapConfig, IngestPayload, IngestResultData, } from './types';
export { bootstrapWidget, submitFeedback } from './api';
export { getApiBaseUrl, getConfig, getContainer, getToken, getBootstrapConfig, isInitialized, isOpen, isTokenExpired, } from './state';
/**
 * Initializes the feedback widget.
 *
 * Calls the bootstrap endpoint to obtain a short-lived token and validates
 * the public key.  Must be called once before `open()`.
 *
 * @param config - Widget configuration. Only `publicKey` is required.
 * @throws {Error} If already initialized, or if the bootstrap call fails.
 */
export declare const init: (config: FeedbackWidgetConfig) => Promise<void>;
/**
 * Opens the feedback widget modal.
 *
 * If the stored token has expired, a transparent re-bootstrap is attempted
 * before opening.
 *
 * @throws {Error} If the widget has not been initialized.
 */
export declare const open: () => Promise<void>;
/**
 * Closes the feedback widget modal.
 *
 * No-op if the widget is already closed.
 */
export declare const close: () => void;
/**
 * Tears down the widget completely.
 *
 * Removes the DOM container and resets all internal state so `init()` can
 * be called again.
 */
export declare const destroy: () => void;
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
export declare const submit: (params: {
    message: string;
    category?: string;
    email?: string;
    pageUrl?: string;
    captchaToken?: string;
}) => Promise<{
    id: string;
    status: string;
    createdAt: string;
}>;
declare const FeedbackWidget: {
    readonly init: (config: FeedbackWidgetConfig) => Promise<void>;
    readonly open: () => Promise<void>;
    readonly close: () => void;
    readonly destroy: () => void;
    readonly submit: (params: {
        message: string;
        category?: string;
        email?: string;
        pageUrl?: string;
        captchaToken?: string;
    }) => Promise<{
        id: string;
        status: string;
        createdAt: string;
    }>;
    /** Low-level API helpers. */
    readonly api: {
        readonly bootstrapWidget: (apiBaseUrl: string, publicKey: string) => Promise<import("./types").BootstrapData>;
        readonly submitFeedback: (apiBaseUrl: string, payload: IngestPayload) => Promise<import("./types").IngestResultData>;
    };
    /** State accessors. */
    readonly state: {
        readonly getConfig: () => Readonly<FeedbackWidgetConfig> | null;
        readonly getToken: () => string | null;
        readonly getBootstrapConfig: () => Readonly<import("./types").BootstrapConfig> | null;
        readonly getApiBaseUrl: () => string;
        readonly getContainer: () => HTMLElement | null;
        readonly isInitialized: () => boolean;
        readonly isOpen: () => boolean;
        readonly isTokenExpired: () => boolean;
    };
};
export default FeedbackWidget;
