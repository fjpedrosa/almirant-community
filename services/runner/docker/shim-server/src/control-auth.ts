import crypto from "node:crypto";

export type ControlAuthConfig =
  | { mode: "disabled"; token?: never }
  | { mode: "static"; token: string }
  | { mode: "bootstrap"; token: string };
export type ControlAuthSnapshot =
  | { readonly mode: "disabled" }
  | { readonly mode: "static" }
  | { readonly mode: "bootstrap" }
  | { readonly mode: "active" };
export type AuthorizationResult = { status: "authorized" } | { status: "unauthorized" };
export type ActivationResult =
  | { status: "activated" }
  | { status: "unauthorized" }
  | { status: "unavailable" };
export type ControlAuth = Readonly<{
  snapshot: () => ControlAuthSnapshot;
  authorize: (authorization: unknown) => AuthorizationResult;
  activate: (authorization: unknown, proposedToken: unknown) => ActivationResult;
}>;

type PrivateState = { mode: "disabled" } | { mode: "static" | "bootstrap" | "active"; token: string };

const isCanonicalToken = (value: unknown): value is string => {
  // Bound work before regex or decoding; base64url decoders alone accept aliases.
  if (typeof value !== "string" || value.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  try {
    return decoded.length === 32 && decoded.toString("base64url") === value;
  } finally {
    decoded.fill(0);
  }
};

const readConfig = (config: ControlAuthConfig): PrivateState => {
  try {
    if (typeof config !== "object" || config === null || Array.isArray(config)) throw new Error();
    // Read data properties only: never invoke caller-controlled accessors.
    const mode = Object.getOwnPropertyDescriptor(config, "mode");
    const token = Object.getOwnPropertyDescriptor(config, "token");
    if (!mode || !("value" in mode)) throw new Error();
    if (mode.value === "disabled" && !token) return { mode: "disabled" };
    if ((mode.value === "static" || mode.value === "bootstrap") &&
        token && "value" in token && isCanonicalToken(token.value)) {
      return { mode: mode.value, token: token.value };
    }
  } catch {
    // Do not propagate input/crypto errors, causes, or credentials.
  }
  throw new Error("Invalid control authentication configuration");
};

const digestToken = (token: string): Buffer => {
  const decoded = Buffer.from(token, "base64url");
  try {
    return crypto.createHash("sha256").update(decoded).digest();
  } finally {
    decoded.fill(0);
  }
};

const tokensMatch = (actual: string, expected: string): boolean => {
  let actualDigest: Buffer | undefined;
  let expectedDigest: Buffer | undefined;
  try {
    actualDigest = digestToken(actual);
    expectedDigest = digestToken(expected);
    return crypto.timingSafeEqual(actualDigest, expectedDigest);
  } finally {
    actualDigest?.fill(0);
    expectedDigest?.fill(0);
  }
};

const bearerMatches = (authorization: unknown, expected: string): boolean => {
  // Exactly seven prefix characters plus a canonical 43-character token.
  if (typeof authorization !== "string" || authorization.length !== 50 ||
      !authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice(7);
  return isCanonicalToken(token) && tokensMatch(token, expected);
};

const createState = (state: PrivateState): ControlAuth => Object.freeze({
  snapshot: (): ControlAuthSnapshot => Object.freeze({ mode: state.mode }),
  authorize: (authorization: unknown): AuthorizationResult => {
    try {
      if (state.mode === "disabled") return { status: "authorized" };
      if (state.mode !== "bootstrap" && bearerMatches(authorization, state.token)) {
        return { status: "authorized" };
      }
    } catch {
      // Fail closed without exposing crypto errors.
    }
    return { status: "unauthorized" };
  },
  activate: (authorization: unknown, proposedToken: unknown): ActivationResult => {
    if (state.mode !== "bootstrap") return { status: "unavailable" };
    try {
      if (!isCanonicalToken(proposedToken) || !bearerMatches(authorization, state.token) ||
          tokensMatch(proposedToken, state.token)) return { status: "unauthorized" };
      // No await/callback: replace the only retained credential before success.
      state = { mode: "active", token: proposedToken };
      return { status: "activated" };
    } catch {
      return { status: "unauthorized" };
    }
  },
});

// No environment, I/O, or activation at import time; caller configuration is not retained.
export const createControlAuth = (config: ControlAuthConfig): ControlAuth => createState(readConfig(config));
