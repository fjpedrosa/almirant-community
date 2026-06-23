/** Position where the widget floats on the page. */
export type WidgetPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
/** Visual theme the widget renders with. */
export type WidgetTheme = 'light' | 'dark' | 'auto';
/**
 * Configuration supplied by the host page when calling `init()`.
 *
 * Only `publicKey` is required; every other field has a sensible default.
 */
export interface FeedbackWidgetConfig {
    /** Public key that identifies the feedback source in Almirant. */
    publicKey: string;
    /**
     * Base URL of the Almirant API.
     * Defaults to `window.location.origin` so the widget works when served
     * from the same domain as the API.
     */
    apiBaseUrl?: string;
    /** Widget position on screen. Defaults to `'bottom-right'`. */
    position?: WidgetPosition;
    /** Color theme. Defaults to `'auto'` (follows `prefers-color-scheme`). */
    theme?: WidgetTheme;
    /** BCP-47 locale tag sent with every submission. */
    locale?: string;
    /** Optional predefined category list the user can choose from. */
    categories?: string[];
    /** Fires after a successful submission with the new item id. */
    onSubmitSuccess?: (data: SubmitSuccessPayload) => void;
    /** Fires when a submission fails. */
    onSubmitError?: (error: Error) => void;
    /** Fires when the widget modal opens. */
    onOpen?: () => void;
    /** Fires when the widget modal closes. */
    onClose?: () => void;
}
/** Payload returned by `onSubmitSuccess`. */
export interface SubmitSuccessPayload {
    id: string;
}
/** Shape of the source descriptor from the bootstrap endpoint. */
export interface BootstrapSource {
    publicKey: string;
    type: string;
    name: string;
}
/** Bootstrap endpoint configuration flags. */
export interface BootstrapConfig {
    requireCaptcha: boolean;
}
/** Successful bootstrap response data. */
export interface BootstrapData {
    source: BootstrapSource;
    token: string;
    expiresAt: number;
    config: BootstrapConfig;
}
/** Generic API envelope used by the Almirant backend. */
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}
/** Payload sent to the ingest endpoint. */
export interface IngestPayload {
    publicKey: string;
    token: string;
    message: string;
    category?: string;
    email?: string;
    pageUrl?: string;
    locale?: string;
    captchaToken?: string;
}
/** Data returned on successful feedback ingestion. */
export interface IngestResultData {
    id: string;
    status: string;
    createdAt: string;
}
/** Mutable internal state managed by the state module. */
export interface WidgetState {
    initialized: boolean;
    config: FeedbackWidgetConfig | null;
    token: string | null;
    expiresAt: number | null;
    bootstrapConfig: BootstrapConfig | null;
    isOpen: boolean;
    container: HTMLElement | null;
}
