import { createSafeOutboundFetch } from "../../../shared/services/outbound-http-policy";
import {
  normalizeClaudeMarketplaceSource,
  parseClaudeMarketplaceCatalog,
  type ClaudeMarketplaceCatalog,
  type ClaudeMarketplaceSource,
} from "./plugin-marketplace";

export interface ClaudeMarketplaceCatalogLoadResult {
  source: ClaudeMarketplaceSource;
  catalog: ClaudeMarketplaceCatalog;
}

export interface ClaudeMarketplaceCatalogLoaderOptions {
  safeFetch?: (
    input: string | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  maxResponseBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
}

export class MarketplaceCatalogLoadError extends Error {
  readonly code = "MARKETPLACE_CATALOG_LOAD_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "MarketplaceCatalogLoadError";
  }
}

const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const fail = (message: string): never => {
  throw new MarketplaceCatalogLoadError(message);
};

const readBoundedResponse = async (
  response: Response,
  maxResponseBytes: number,
): Promise<Uint8Array> => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    return fail(`Marketplace catalog cannot exceed ${maxResponseBytes} bytes`);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        return fail(`Marketplace catalog cannot exceed ${maxResponseBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
};

export const createClaudeMarketplaceCatalogLoader = (
  options: ClaudeMarketplaceCatalogLoaderOptions = {},
) => {
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const safeFetch = options.safeFetch ?? createSafeOutboundFetch({
    allowRedirectResponses: true,
    maxResponseBodyBytes: maxResponseBytes,
    timeoutMs,
  });

  return async (rawSource: string): Promise<ClaudeMarketplaceCatalogLoadResult> => {
    let source: ClaudeMarketplaceSource;
    try {
      source = normalizeClaudeMarketplaceSource(rawSource);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Invalid marketplace source");
    }

    let currentUrl = new URL(source.catalogUrl);
    let response: Response | null = null;
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      try {
        response = await safeFetch(currentUrl, {
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { Accept: "application/json" },
        });
      } catch {
        return fail("Marketplace catalog request failed");
      }

      if (!REDIRECT_STATUSES.has(response.status)) break;
      if (redirectCount >= maxRedirects) {
        await response.body?.cancel().catch(() => undefined);
        return fail(`Marketplace catalog exceeded ${maxRedirects} redirects`);
      }
      const location = response.headers.get("location");
      if (!location) {
        await response.body?.cancel().catch(() => undefined);
        return fail("Marketplace catalog redirect has no location");
      }
      try {
        currentUrl = new URL(location, currentUrl);
      } catch {
        await response.body?.cancel().catch(() => undefined);
        return fail("Marketplace catalog redirect is invalid");
      }
      await response.body?.cancel().catch(() => undefined);
      response = null;
    }

    if (!response || !response.ok) {
      return fail(`Marketplace catalog request returned HTTP ${response?.status ?? "unknown"}`);
    }

    const bytes = await readBoundedResponse(response, maxResponseBytes);
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return fail("Marketplace catalog is not valid UTF-8 JSON");
    }

    try {
      return { source, catalog: parseClaudeMarketplaceCatalog(payload) };
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Marketplace catalog is invalid");
    }
  };
};

export const loadClaudeMarketplaceCatalog = createClaudeMarketplaceCatalogLoader();
