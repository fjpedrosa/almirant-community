export interface ClaimedAgentOutputDelivery {
  id: string;
  submissionId: string;
  status: "delivering";
  stateVersion: number;
  attempts: number;
  leaseOwner: string | null;
  idempotencyKey: string;
  endpointOrigin: string;
  pathTemplate: string;
  headerTemplates: Record<string, string>;
  encryptedHeaders: string | null;
  headersIv: string | null;
  headersAuthTag: string | null;
  encryptedBinding: string | null;
  bindingIv: string | null;
  bindingAuthTag: string | null;
  payload: unknown | null;
  errorCode: string | null;
  errorMessage: string | null;
  jobId: string;
  runId: string;
}

type SafeFetch = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

interface AgentOutputDeliverySweeperDependencies {
  claim(options: {
    leaseOwner: string;
    leaseMs?: number;
    limit?: number;
    now?: Date;
  }): Promise<ClaimedAgentOutputDelivery[]>;
  decrypt(
    encrypted: string,
    iv: string,
    authTag: string,
  ): Record<string, unknown>;
  safeFetch: SafeFetch;
  complete(input: {
    deliveryId: string;
    expectedStateVersion: number;
    leaseOwner: string;
    responseStatus: number;
    now: Date;
  }): Promise<boolean>;
  fail(input: {
    deliveryId: string;
    expectedStateVersion: number;
    leaseOwner: string;
    disposition: "retry" | "dead_letter";
    errorCode: string;
    responseStatus?: number;
    retryAt?: Date;
    now: Date;
  }): Promise<boolean>;
  now?: () => Date;
  random?: () => number;
  maxAttempts?: number;
}

class UnsafeAgentOutputDestinationError extends Error {}
class AgentOutputSecretError extends Error {}

const PLACEHOLDER = /\{\{binding\.([A-Za-z0-9_.-]+)\}\}/g;
const RESERVED_HEADERS = new Set([
  "connection",
  "content-length",
  "content-type",
  "host",
  "idempotency-key",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const readBindingValue = (
  binding: Record<string, unknown>,
  key: string,
): string => {
  const value = binding[key];
  if (typeof value !== "string") {
    throw new UnsafeAgentOutputDestinationError(
      "Missing output binding value",
    );
  }
  return value;
};

const replaceBindingPlaceholders = (
  template: string,
  binding: Record<string, unknown>,
  encode: boolean,
): string =>
  template.replace(PLACEHOLDER, (_placeholder, key: string) => {
    const value = readBindingValue(binding, key);
    return encode ? encodeURIComponent(value) : value;
  });

const assertNoUnresolvedPlaceholders = (value: string): void => {
  if (value.includes("{{") || value.includes("}}")) {
    throw new UnsafeAgentOutputDestinationError(
      "Unresolved output binding placeholder",
    );
  }
};

const assembleTarget = (
  delivery: ClaimedAgentOutputDelivery,
  binding: Record<string, unknown>,
  staticHeaders: Record<string, unknown>,
): { url: string; headers: Headers } => {
  let origin: URL;
  try {
    origin = new URL(delivery.endpointOrigin);
  } catch {
    throw new UnsafeAgentOutputDestinationError(
      "Invalid output sink origin",
    );
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.origin !== delivery.endpointOrigin
  ) {
    throw new UnsafeAgentOutputDestinationError(
      "Output sink origin is not exact",
    );
  }
  if (
    !delivery.pathTemplate.startsWith("/") ||
    delivery.pathTemplate.startsWith("//") ||
    delivery.pathTemplate.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(delivery.pathTemplate)
  ) {
    throw new UnsafeAgentOutputDestinationError(
      "Output path template is unsafe",
    );
  }

  const renderedPath = replaceBindingPlaceholders(
    delivery.pathTemplate,
    binding,
    true,
  );
  assertNoUnresolvedPlaceholders(renderedPath);
  const url = new URL(renderedPath, `${origin.origin}/`);
  if (url.origin !== origin.origin || url.hash) {
    throw new UnsafeAgentOutputDestinationError(
      "Output binding escaped the pinned origin",
    );
  }

  const headers = new Headers();
  const appendHeader = (name: string, rawValue: unknown): void => {
    if (
      typeof rawValue !== "string" ||
      RESERVED_HEADERS.has(name.toLowerCase())
    ) {
      throw new UnsafeAgentOutputDestinationError(
        "Output header is unsafe",
      );
    }
    const value = replaceBindingPlaceholders(rawValue, binding, false);
    assertNoUnresolvedPlaceholders(value);
    try {
      headers.set(name, value);
    } catch {
      throw new UnsafeAgentOutputDestinationError(
        "Output header is invalid",
      );
    }
  };

  for (const [name, value] of Object.entries(staticHeaders)) {
    appendHeader(name, value);
  }
  for (const [name, value] of Object.entries(delivery.headerTemplates)) {
    appendHeader(name, value);
  }
  headers.set("content-type", "application/json");
  headers.set("idempotency-key", delivery.idempotencyKey);
  return { url: url.toString(), headers };
};

const decryptOptionalRecord = (
  decrypt: AgentOutputDeliverySweeperDependencies["decrypt"],
  encrypted: string | null,
  iv: string | null,
  authTag: string | null,
): Record<string, unknown> => {
  if (!encrypted && !iv && !authTag) return {};
  if (!encrypted || !iv || !authTag) {
    throw new AgentOutputSecretError(
      "Incomplete output secret envelope",
    );
  }
  try {
    const decrypted = decrypt(encrypted, iv, authTag);
    if (
      !decrypted ||
      typeof decrypted !== "object" ||
      Array.isArray(decrypted)
    ) {
      throw new Error("not an object");
    }
    return decrypted;
  } catch {
    throw new AgentOutputSecretError(
      "Output secret envelope cannot be decrypted",
    );
  }
};

const retryAt = (
  now: Date,
  attempts: number,
  random: () => number,
): Date => {
  const exponent = Math.max(0, Math.min(attempts - 1, 10));
  const base = Math.min(1_000 * 2 ** exponent, 15 * 60_000);
  const jitter = 0.5 + Math.min(Math.max(random(), 0), 1);
  return new Date(now.getTime() + Math.round(base * jitter));
};

const errorCodeForStatus = (status: number): string => {
  if (status >= 500) return "delivery_http_5xx";
  if ([408, 425, 429].includes(status)) return "delivery_http_transient";
  return "delivery_http_4xx";
};

const isTransientStatus = (status: number): boolean =>
  status >= 500 || [408, 425, 429].includes(status);

export const createAgentOutputDeliverySweeper = (
  dependencies: AgentOutputDeliverySweeperDependencies,
) => ({
  sweep: async (options: {
    leaseOwner: string;
    leaseMs?: number;
    limit?: number;
  }): Promise<{
    claimed: number;
    delivered: number;
    retried: number;
    deadLettered: number;
  }> => {
    const claimed = await dependencies.claim({
      ...options,
      now: dependencies.now?.() ?? new Date(),
    });
    const counters = {
      claimed: claimed.length,
      delivered: 0,
      retried: 0,
      deadLettered: 0,
    };
    const maxAttempts = Math.max(dependencies.maxAttempts ?? 5, 1);

    for (const delivery of claimed) {
      if (delivery.leaseOwner !== options.leaseOwner) {
        continue;
      }
      try {
        const binding = decryptOptionalRecord(
          dependencies.decrypt,
          delivery.encryptedBinding,
          delivery.bindingIv,
          delivery.bindingAuthTag,
        );
        const staticHeaders = decryptOptionalRecord(
          dependencies.decrypt,
          delivery.encryptedHeaders,
          delivery.headersIv,
          delivery.headersAuthTag,
        );
        const target = assembleTarget(delivery, binding, staticHeaders);
        const response = await dependencies.safeFetch(target.url, {
          method: "POST",
          headers: target.headers,
          body: JSON.stringify({
            schemaVersion: 1,
            jobId: delivery.jobId,
            runId: delivery.runId,
            submissionId: delivery.submissionId,
            status: delivery.errorCode ? "failed" : "succeeded",
            output: delivery.payload,
            error: delivery.errorCode
              ? {
                  code: delivery.errorCode,
                  message: delivery.errorMessage,
                }
              : null,
          }),
          redirect: "error",
        });
        await response.body?.cancel().catch(() => undefined);
        const transitionNow = dependencies.now?.() ?? new Date();

        if (response.ok) {
          const completed = await dependencies.complete({
            deliveryId: delivery.id,
            expectedStateVersion: delivery.stateVersion,
            leaseOwner: options.leaseOwner,
            responseStatus: response.status,
            now: transitionNow,
          });
          if (completed) counters.delivered += 1;
          continue;
        }

        const transient = isTransientStatus(response.status);
        const disposition =
          transient && delivery.attempts < maxAttempts
            ? "retry"
            : "dead_letter";
        const failed = await dependencies.fail({
          deliveryId: delivery.id,
          expectedStateVersion: delivery.stateVersion,
          leaseOwner: options.leaseOwner,
          disposition,
          errorCode: errorCodeForStatus(response.status),
          responseStatus: response.status,
          ...(disposition === "retry"
            ? {
                retryAt: retryAt(
                  transitionNow,
                  delivery.attempts,
                  dependencies.random ?? Math.random,
                ),
              }
            : {}),
          now: transitionNow,
        });
        if (failed) {
          if (disposition === "retry") counters.retried += 1;
          else counters.deadLettered += 1;
        }
      } catch (error) {
        const transitionNow = dependencies.now?.() ?? new Date();
        const permanent =
          error instanceof UnsafeAgentOutputDestinationError ||
          error instanceof AgentOutputSecretError;
        const disposition =
          !permanent && delivery.attempts < maxAttempts
            ? "retry"
            : "dead_letter";
        const errorCode =
          error instanceof UnsafeAgentOutputDestinationError
            ? "unsafe_destination"
            : error instanceof AgentOutputSecretError
              ? "delivery_secret_unavailable"
              : "delivery_network_error";
        const failed = await dependencies.fail({
          deliveryId: delivery.id,
          expectedStateVersion: delivery.stateVersion,
          leaseOwner: options.leaseOwner,
          disposition,
          errorCode,
          ...(disposition === "retry"
            ? {
                retryAt: retryAt(
                  transitionNow,
                  delivery.attempts,
                  dependencies.random ?? Math.random,
                ),
              }
            : {}),
          now: transitionNow,
        });
        if (failed) {
          if (disposition === "retry") counters.retried += 1;
          else counters.deadLettered += 1;
        }
      }
    }
    return counters;
  },
});

export type AgentOutputDeliverySweeper = ReturnType<
  typeof createAgentOutputDeliverySweeper
>;
