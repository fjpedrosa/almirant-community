type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ActivatePiShimControlAuthInput = Readonly<{
  /** Trusted runner-owned origin; this client does not discover or authorize hosts. */
  baseUrl: string;
  bootstrapToken: string;
  activeToken: string;
  signal: AbortSignal;
  /** Total request budget, split between activation and the optional proof. */
  timeoutMs?: number;
  fetchImpl?: FetchImplementation;
}>;

export class PiShimControlAuthActivationError extends Error {
  readonly code = "PI_SHIM_CONTROL_AUTH_ACTIVATION_FAILED";
  constructor(readonly reason: "invalid_input" | "aborted" | "activation_unproven") {
    super(`Pi shim control authentication failed: ${reason}`);
    this.name = "PiShimControlAuthActivationError";
  }
}

const isCanonicalToken = (value: string): boolean => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  let decoded: Buffer | undefined;
  try {
    decoded = Buffer.from(value, "base64url");
    return decoded.length === 32 && decoded.toString("base64url") === value;
  } catch {
    return false;
  } finally {
    decoded?.fill(0);
  }
};

const trustedOrigin = (baseUrl: string): string | null => {
  // Reject syntax the URL parser would silently normalize (including empty ?/#).
  if (typeof baseUrl !== "string" || !/^https?:\/\/[^/?#\\\s@]+\/?$/i.test(baseUrl)) return null;
  try {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    const loopback = url.hostname === "localhost" || url.hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (url.protocol === "http:" && !loopback) return null;
    return url.origin;
  } catch {
    return null;
  }
};

const requestStatus = async (
  fetchImpl: FetchImplementation, url: string, init: RequestInit,
  parent: AbortSignal, budgetMs: number,
): Promise<number | null> => {
  const controller = new AbortController();
  const abort = () => controller.abort(); // Never forward the caller's potentially secret reason.
  parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, budgetMs);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new PiShimControlAuthActivationError("aborted"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  // Race handlers remain attached to the transport even after timeout/abort,
  // consuming late rejections from transports that ignore AbortSignal.
  const request = Promise.resolve().then(async () => {
    if (parent.aborted) abort();
    if (controller.signal.aborted) return null;
    const result = await fetchImpl(url, { ...init, signal: controller.signal });
    try {
      return result.status;
    } finally {
      // Dispose even late responses; cleanup must never delay or change proof.
      try {
        void Promise.resolve(result.body?.cancel()).catch(() => {});
      } catch {
        // Untrusted body getters and synchronous cancellation failures are ignored.
      }
    }
  });
  try {
    return await Promise.race([request, aborted]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
  }
};

/** One activation attempt, then at most one read-only proof; never creates a session. */
export const activatePiShimControlAuth = async (
  input: ActivatePiShimControlAuthInput,
): Promise<void> => {
  const timeoutMs = input.timeoutMs === undefined ? 10_000 : input.timeoutMs;
  const origin = trustedOrigin(input.baseUrl);
  // Node/Bun timers overflow above signed int32; reserve at least 1ms per request.
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 2 || timeoutMs > 2 ** 31 - 1 ||
    !origin || !isCanonicalToken(input.bootstrapToken) || !isCanonicalToken(input.activeToken) ||
    input.bootstrapToken === input.activeToken) {
    throw new PiShimControlAuthActivationError("invalid_input");
  }
  const checkAbort = () => {
    if (input.signal.aborted) throw new PiShimControlAuthActivationError("aborted");
  };
  checkAbort();
  const fetchImpl = input.fetchImpl ?? fetch;
  const activationBudget = Math.floor(timeoutMs / 2);
  const activationStatus = await requestStatus(fetchImpl, `${origin}/control/activate`, {
    method: "POST", redirect: "manual",
    headers: {
      Authorization: `Bearer ${input.bootstrapToken}`,
      "X-Almirant-Active-Token": input.activeToken,
    },
  }, input.signal, activationBudget);
  checkAbort();
  if (activationStatus === 204) return;

  const proofStatus = await requestStatus(fetchImpl, `${origin}/session`, {
    method: "GET", redirect: "manual",
    headers: { Authorization: `Bearer ${input.activeToken}` },
  }, input.signal, timeoutMs - activationBudget);
  checkAbort();
  if (proofStatus !== 200) throw new PiShimControlAuthActivationError("activation_unproven");
};
