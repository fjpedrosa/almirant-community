import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

export interface OutboundNetworkAddress {
  address: string;
  family: 4 | 6;
}

export interface ValidatedOutboundUrl {
  url: URL;
  addresses: OutboundNetworkAddress[];
  isLocalDevelopment: boolean;
}

export interface ValidateOutboundHttpUrlOptions {
  nodeEnv?: string;
  resolveHostname?: (hostname: string) => Promise<OutboundNetworkAddress[]>;
}

export class OutboundUrlPolicyError extends Error {
  readonly code = "UNSAFE_OUTBOUND_URL";

  constructor(message: string) {
    super(message);
    this.name = "OutboundUrlPolicyError";
  }
}

export class OutboundResponseLimitError extends Error {
  readonly code = "OUTBOUND_RESPONSE_TOO_LARGE";

  constructor() {
    super("Outbound MCP response exceeds the safety limit.");
    this.name = "OutboundResponseLimitError";
  }
}

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  // Reject IPv4-mapped addresses conservatively. Public DNS should return
  // native A/AAAA records, and accepting mapped values complicates auditing.
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

const loopbackIpv4 = new BlockList();
loopbackIpv4.addSubnet("127.0.0.0", 8, "ipv4");
const loopbackIpv6 = new BlockList();
loopbackIpv6.addAddress("::1", "ipv6");
loopbackIpv6.addSubnet("::ffff:127.0.0.0", 104, "ipv6");

const normalizeHostname = (hostname: string): string =>
  hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();

const isExplicitLocalhost = (hostname: string): boolean => {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    loopbackIpv4.check(normalized, "ipv4") ||
    loopbackIpv6.check(normalized, "ipv6")
  );
};

const isLoopbackAddress = ({ address, family }: OutboundNetworkAddress): boolean =>
  family === 4
    ? loopbackIpv4.check(address, "ipv4")
    : loopbackIpv6.check(address, "ipv6");

const isPublicAddress = ({ address, family }: OutboundNetworkAddress): boolean => {
  if (isIP(address) !== family) return false;
  return family === 4
    ? !blockedIpv4.check(address, "ipv4")
    : !blockedIpv6.check(address, "ipv6");
};

const defaultResolveHostname = async (
  hostname: string,
): Promise<OutboundNetworkAddress[]> => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.flatMap((result) =>
    result.family === 4 || result.family === 6
      ? [{ address: result.address, family: result.family }]
      : [],
  );
};

export const validateOutboundHttpUrl = async (
  rawUrl: string | URL,
  options: ValidateOutboundHttpUrlOptions = {},
): Promise<ValidatedOutboundUrl> => {
  let url: URL;
  try {
    url = new URL(rawUrl.toString());
  } catch {
    throw new OutboundUrlPolicyError("MCP URL must be a valid HTTP(S) URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new OutboundUrlPolicyError("MCP URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new OutboundUrlPolicyError("MCP URL cannot contain embedded credentials.");
  }

  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "production";
  const allowsLocalDevelopment = nodeEnv === "development" || nodeEnv === "test";
  const hostname = normalizeHostname(url.hostname);
  const explicitLocalhost = isExplicitLocalhost(hostname);

  if (!allowsLocalDevelopment && url.protocol !== "https:") {
    throw new OutboundUrlPolicyError("MCP URL must use HTTPS outside local development.");
  }
  if (allowsLocalDevelopment && url.protocol === "http:" && !explicitLocalhost) {
    throw new OutboundUrlPolicyError("Plain HTTP is allowed only for explicit localhost development endpoints.");
  }

  let addresses: OutboundNetworkAddress[];
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = await (options.resolveHostname ?? defaultResolveHostname)(hostname);
    } catch {
      throw new OutboundUrlPolicyError("MCP URL could not be resolved safely.");
    }
  }

  if (addresses.length === 0) {
    throw new OutboundUrlPolicyError("MCP URL could not be resolved safely.");
  }

  const isLocalDevelopment = allowsLocalDevelopment && explicitLocalhost;
  if (isLocalDevelopment) {
    if (!addresses.every(isLoopbackAddress)) {
      throw new OutboundUrlPolicyError("Local development MCP URLs must resolve only to loopback addresses.");
    }
  } else if (!addresses.every(isPublicAddress)) {
    throw new OutboundUrlPolicyError("MCP URL must resolve only to a public network destination.");
  }

  url.hash = "";
  return { url, addresses, isLocalDevelopment };
};

type PerformOutboundRequest = (
  validated: ValidatedOutboundUrl,
  init: RequestInit,
) => Promise<Response>;

export interface CreateSafeOutboundFetchOptions {
  timeoutMs?: number;
  maxRequestBodyBytes?: number;
  maxResponseBodyBytes?: number;
  /** Return pinned 3xx responses to a caller that will validate each redirect hop. */
  allowRedirectResponses?: boolean;
  validateUrl?: typeof validateOutboundHttpUrl;
  performRequest?: PerformOutboundRequest;
}

const DEFAULT_MAX_OUTBOUND_RESPONSE_BODY_BYTES = 4 * 1024 * 1024;
const MAX_OUTBOUND_RESPONSE_BODY_BYTES = 12 * 1024 * 1024;

const hasOversizedContentLength = (
  response: Response,
  maxResponseBodyBytes: number,
): boolean => {
  const rawContentLength = response.headers.get("content-length")?.trim();
  if (!rawContentLength || !/^\d+$/.test(rawContentLength)) return false;
  // A Content-Length with more than 16 decimal digits is necessarily well
  // beyond this policy's 12 MiB hard maximum; avoid parsing attacker-sized
  // integers unnecessarily.
  if (rawContentLength.length > 16) return true;
  return BigInt(rawContentLength) > BigInt(maxResponseBodyBytes);
};

const limitResponseBody = async (
  response: Response,
  maxResponseBodyBytes: number,
  abort: (reason: Error) => void,
): Promise<Response> => {
  if (hasOversizedContentLength(response, maxResponseBodyBytes)) {
    const error = new OutboundResponseLimitError();
    await response.body?.cancel(error).catch(() => undefined);
    abort(error);
    throw error;
  }

  if (!response.body) return response;

  const reader = response.body.getReader();
  let receivedBytes = 0;
  const limitedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
          return;
        }

        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > maxResponseBodyBytes) {
          const error = new OutboundResponseLimitError();
          await reader.cancel(error).catch(() => undefined);
          abort(error);
          controller.error(error);
          return;
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined);
      abort(reason instanceof Error ? reason : new Error("MCP response cancelled"));
    },
  });

  return new Response(limitedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

const writeRequestBody = async (
  request: ReturnType<typeof httpRequest>,
  body: RequestInit["body"],
  maxBytes: number,
): Promise<void> => {
  if (body == null) {
    request.end();
    return;
  }

  let bytes: Uint8Array;
  if (typeof body === "string") {
    bytes = new TextEncoder().encode(body);
  } else if (body instanceof URLSearchParams) {
    bytes = new TextEncoder().encode(body.toString());
  } else if (body instanceof Blob) {
    bytes = new Uint8Array(await body.arrayBuffer());
  } else if (body instanceof ArrayBuffer) {
    bytes = new Uint8Array(body);
  } else if (ArrayBuffer.isView(body)) {
    bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  } else {
    throw new OutboundUrlPolicyError("Unsupported outbound MCP request body.");
  }

  if (bytes.byteLength > maxBytes) {
    throw new OutboundUrlPolicyError("Outbound MCP request body exceeds the safety limit.");
  }
  request.end(bytes);
};

const performPinnedHttpRequest = (
  validated: ValidatedOutboundUrl,
  init: RequestInit,
  maxRequestBodyBytes: number,
): Promise<Response> =>
  new Promise((resolve, reject) => {
    const address = validated.addresses[0];
    if (!address) {
      reject(new OutboundUrlPolicyError("MCP URL could not be resolved safely."));
      return;
    }

    const headers = new Headers(init.headers);
    // The destination host is derived exclusively from the validated URL.
    headers.delete("host");
    headers.delete("content-length");

    const requestFn = validated.url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requestFn(
      validated.url,
      {
        method: init.method ?? "GET",
        headers: Object.fromEntries(headers.entries()),
        signal: init.signal ?? undefined,
        lookup: (_hostname, options, callback) => {
          // Node/Bun's HTTP client invokes the custom lookup with
          // `{ all: true }` and expects an array of address records it can
          // sort; the legacy `(err, address, family)` form makes Bun throw
          // `results.sort is not a function`. Honor both call shapes.
          if (options && (options as { all?: boolean }).all) {
            (
              callback as unknown as (
                err: null,
                addresses: Array<{ address: string; family: number }>,
              ) => void
            )(null, [{ address: address.address, family: address.family }]);
          } else {
            callback(null, address.address, address.family);
          }
        },
        ...(validated.url.protocol === "https:"
          ? { servername: normalizeHostname(validated.url.hostname) }
          : {}),
      },
      (response) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value !== undefined) {
            responseHeaders.set(name, String(value));
          }
        }

        const body = Readable.toWeb(response) as ReadableStream<Uint8Array>;
        resolve(
          new Response(body, {
            status: response.statusCode ?? 500,
            statusText: response.statusMessage,
            headers: responseHeaders,
          }),
        );
      },
    );

    request.once("error", reject);
    void writeRequestBody(request, init.body, maxRequestBodyBytes).catch((error) => {
      request.destroy(error instanceof Error ? error : new Error("Outbound request failed"));
      reject(error);
    });
  });

export const createSafeOutboundFetch = (
  options: CreateSafeOutboundFetchOptions = {},
): ((url: string | URL, init?: RequestInit) => Promise<Response>) => {
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 8_000, 100), 30_000);
  const maxRequestBodyBytes = Math.min(
    Math.max(options.maxRequestBodyBytes ?? 1_048_576, 1),
    4_194_304,
  );
  const maxResponseBodyBytes = Math.min(
    Math.max(
      options.maxResponseBodyBytes ?? DEFAULT_MAX_OUTBOUND_RESPONSE_BODY_BYTES,
      1,
    ),
    MAX_OUTBOUND_RESPONSE_BODY_BYTES,
  );
  const allowRedirectResponses = options.allowRedirectResponses ?? false;
  const validateUrl = options.validateUrl ?? validateOutboundHttpUrl;
  const performRequest = options.performRequest ?? ((validated, init) =>
    performPinnedHttpRequest(validated, init, maxRequestBodyBytes));

  return async (rawUrl, init = {}) => {
    const validated = await validateUrl(rawUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new DOMException("Outbound MCP request timed out", "TimeoutError"));
    }, timeoutMs);
    const callerSignal = init.signal;
    const abortFromCaller = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    if (callerSignal?.aborted) abortFromCaller();
    let responseReturned = false;

    try {
      const response = await performRequest(validated, {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      });
      if (
        !allowRedirectResponses &&
        response.status >= 300 &&
        response.status < 400
      ) {
        await response.body?.cancel().catch(() => undefined);
        throw new OutboundUrlPolicyError("Outbound MCP redirects are not allowed.");
      }
      const limitedResponse = await limitResponseBody(
        response,
        maxResponseBodyBytes,
        (reason) => controller.abort(reason),
      );
      responseReturned = true;
      return limitedResponse;
    } finally {
      clearTimeout(timeout);
      // For streaming MCP responses the transport's abort signal must remain
      // wired after response headers arrive; client.close() then closes the
      // underlying socket. Failed requests can detach immediately.
      if (!responseReturned) {
        callerSignal?.removeEventListener("abort", abortFromCaller);
      }
    }
  };
};
