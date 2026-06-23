// ---------------------------------------------------------------------------
// Feedback Widget - API Module
// ---------------------------------------------------------------------------
// Pure functions that communicate with the Almirant public feedback
// endpoints.  Uses the browser `fetch` API -- zero runtime dependencies.
// ---------------------------------------------------------------------------

import type {
  ApiResponse,
  BootstrapData,
  IngestPayload,
  IngestResultData,
} from './types';

// ---------------------------------------------------------------------------
// Typed error classes for specific failure modes
// ---------------------------------------------------------------------------

/** Thrown when the server responds with 429 Too Many Requests. */
export class RateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** Thrown when the network request itself fails (offline, DNS, CORS, etc.). */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Calls the widget bootstrap endpoint to obtain a short-lived HMAC token.
 *
 * @param apiBaseUrl - Almirant API base URL (no trailing slash).
 * @param publicKey  - The public key identifying the feedback source.
 * @returns The bootstrap data including token and configuration.
 * @throws {Error} When the request fails or the server returns an error.
 */
export const bootstrapWidget = async (
  apiBaseUrl: string,
  publicKey: string,
): Promise<BootstrapData> => {
  const url = `${apiBaseUrl}/feedback/widget/bootstrap?publicKey=${encodeURIComponent(publicKey)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  const body: ApiResponse<BootstrapData> = await response.json();

  if (!response.ok || !body.success || !body.data) {
    throw new Error(body.error ?? `Bootstrap failed with status ${response.status}`);
  }

  return body.data;
};

/**
 * Submits user feedback to the ingest endpoint.
 *
 * @param apiBaseUrl - Almirant API base URL (no trailing slash).
 * @param payload    - The feedback data to submit.
 * @returns The ingested feedback item metadata.
 * @throws {Error} When the request fails, is rate-limited, or the server
 *                 returns an error.
 */
export const submitFeedback = async (
  apiBaseUrl: string,
  payload: IngestPayload,
): Promise<IngestResultData> => {
  const url = `${apiBaseUrl}/feedback/ingest`;

  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new NetworkError(
      'Network error. Check your connection and try again.',
    );
  }

  // Handle rate limiting (429) before parsing body -- some servers may not
  // return valid JSON on 429 responses.
  if (response.status === 429) {
    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfterMs = retryAfterHeader
      ? parseInt(retryAfterHeader, 10) * 1000
      : 60_000; // Default 60 s if header missing.

    throw new RateLimitError(
      'Too many submissions. Please wait and try again.',
      retryAfterMs,
    );
  }

  let body: ApiResponse<IngestResultData>;

  try {
    body = await response.json();
  } catch {
    throw new Error(`Ingest failed with status ${response.status}`);
  }

  if (!response.ok || !body.success || !body.data) {
    throw new Error(body.error ?? `Ingest failed with status ${response.status}`);
  }

  return body.data;
};
