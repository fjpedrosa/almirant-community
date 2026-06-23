import type { BootstrapData, IngestPayload, IngestResultData } from './types';
/**
 * Calls the widget bootstrap endpoint to obtain a short-lived HMAC token.
 *
 * @param apiBaseUrl - Almirant API base URL (no trailing slash).
 * @param publicKey  - The public key identifying the feedback source.
 * @returns The bootstrap data including token and configuration.
 * @throws {Error} When the request fails or the server returns an error.
 */
export declare const bootstrapWidget: (apiBaseUrl: string, publicKey: string) => Promise<BootstrapData>;
/**
 * Submits user feedback to the ingest endpoint.
 *
 * @param apiBaseUrl - Almirant API base URL (no trailing slash).
 * @param payload    - The feedback data to submit.
 * @returns The ingested feedback item metadata.
 * @throws {Error} When the request fails, is rate-limited, or the server
 *                 returns an error.
 */
export declare const submitFeedback: (apiBaseUrl: string, payload: IngestPayload) => Promise<IngestResultData>;
