import { createHash, randomBytes, timingSafeEqual } from "crypto";

export const MCP_OAUTH_SCOPES = ["mcp:read", "mcp:write"] as const;

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const DYNAMIC_CLIENT_TTL_MS = 90 * 24 * 60 * 60 * 1000;

type CodeChallengeMethod = "S256" | "plain";

interface AuthorizationCodeEntry {
  code: string;
  clientId: string;
  redirectUri: string;
  workspaceId: string;
  userId: string;
  projectId?: string;
  scope: string;
  codeChallenge?: string;
  codeChallengeMethod?: CodeChallengeMethod;
  expiresAt: Date;
}

interface DynamicClientEntry {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  clientName?: string;
  issuedAt: Date;
  expiresAt: Date;
}

const authorizationCodes = new Map<string, AuthorizationCodeEntry>();
const dynamicClients = new Map<string, DynamicClientEntry>();

const base64Url = (buffer: Buffer): string =>
  buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const secureToken = (bytes = 32): string => base64Url(randomBytes(bytes));

const isLocalhostRedirect = (url: URL): boolean =>
  ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

export const isAllowedChatGptRedirectUri = (
  redirectUri: string,
  nodeEnv: string = process.env.NODE_ENV ?? "development",
): boolean => {
  try {
    const url = new URL(redirectUri);
    const allowedChatGptOrigins = new Set([
      "https://chatgpt.com",
      "https://chat.openai.com",
    ]);

    if (allowedChatGptOrigins.has(url.origin)) {
      return url.protocol === "https:";
    }

    // Test/development escape hatch for local OAuth client tests only.
    if (nodeEnv !== "production" && isLocalhostRedirect(url)) {
      return url.protocol === "http:" || url.protocol === "https:";
    }

    return false;
  } catch {
    return false;
  }
};

const cleanupExpiredEntries = (): void => {
  const now = Date.now();

  for (const [code, entry] of authorizationCodes.entries()) {
    if (entry.expiresAt.getTime() <= now) {
      authorizationCodes.delete(code);
    }
  }

  for (const [clientId, entry] of dynamicClients.entries()) {
    if (entry.expiresAt.getTime() <= now) {
      dynamicClients.delete(clientId);
    }
  }
};

export const registerMcpOAuthClient = (input: {
  redirectUris: string[];
  clientName?: string;
  nodeEnv?: string;
}): DynamicClientEntry => {
  cleanupExpiredEntries();

  const redirectUris = [...new Set(input.redirectUris.map((uri) => uri.trim()))]
    .filter(Boolean);

  if (redirectUris.length === 0) {
    throw new Error("At least one redirect_uri is required");
  }

  const invalid = redirectUris.filter(
    (uri) => !isAllowedChatGptRedirectUri(uri, input.nodeEnv),
  );
  if (invalid.length > 0) {
    throw new Error("redirect_uris must target ChatGPT or localhost in development");
  }

  const issuedAt = new Date();
  const client: DynamicClientEntry = {
    clientId: `alm_mcp_${secureToken(18)}`,
    clientSecret: secureToken(32),
    redirectUris,
    ...(input.clientName ? { clientName: input.clientName } : {}),
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + DYNAMIC_CLIENT_TTL_MS),
  };

  dynamicClients.set(client.clientId, client);
  return client;
};

export const validateMcpOAuthClient = (input: {
  clientId: string;
  redirectUri: string;
  clientSecret?: string;
  requireSecret?: boolean;
  nodeEnv?: string;
}): boolean => {
  cleanupExpiredEntries();

  const registered = dynamicClients.get(input.clientId);
  if (!registered) {
    // Static-client fallback: ChatGPT can be configured manually without DCR.
    return isAllowedChatGptRedirectUri(input.redirectUri, input.nodeEnv);
  }

  if (!registered.redirectUris.includes(input.redirectUri)) {
    return false;
  }

  if (!input.requireSecret) {
    return true;
  }

  if (!input.clientSecret) {
    return false;
  }

  const expected = Buffer.from(registered.clientSecret);
  const actual = Buffer.from(input.clientSecret);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const createMcpAuthorizationCode = (input: {
  clientId: string;
  redirectUri: string;
  workspaceId: string;
  userId: string;
  projectId?: string;
  scope?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}): AuthorizationCodeEntry => {
  cleanupExpiredEntries();

  const method = input.codeChallengeMethod as CodeChallengeMethod | undefined;
  if (input.codeChallenge && method && !["S256", "plain"].includes(method)) {
    throw new Error("Unsupported code_challenge_method");
  }

  const code = `alm_oac_${secureToken(32)}`;
  const entry: AuthorizationCodeEntry = {
    code,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    workspaceId: input.workspaceId,
    userId: input.userId,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    scope: input.scope ?? MCP_OAUTH_SCOPES.join(" "),
    ...(input.codeChallenge ? { codeChallenge: input.codeChallenge } : {}),
    ...(method ? { codeChallengeMethod: method } : {}),
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
  };

  authorizationCodes.set(code, entry);
  return entry;
};

const verifyPkce = (
  codeVerifier: string,
  codeChallenge: string,
  method: CodeChallengeMethod = "plain",
): boolean => {
  const actual =
    method === "S256"
      ? base64Url(createHash("sha256").update(codeVerifier).digest())
      : codeVerifier;

  const expected = Buffer.from(codeChallenge);
  const received = Buffer.from(actual);
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export const consumeMcpAuthorizationCode = (input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier?: string;
  clientSecret?: string;
  nodeEnv?: string;
}): AuthorizationCodeEntry | null => {
  cleanupExpiredEntries();

  const entry = authorizationCodes.get(input.code);
  if (!entry) return null;

  // Authorization codes are single-use even when validation fails.
  authorizationCodes.delete(input.code);

  if (entry.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  if (entry.clientId !== input.clientId || entry.redirectUri !== input.redirectUri) {
    return null;
  }

  if (
    !validateMcpOAuthClient({
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      clientSecret: input.clientSecret,
      requireSecret: dynamicClients.has(input.clientId),
      nodeEnv: input.nodeEnv,
    })
  ) {
    return null;
  }

  if (entry.codeChallenge) {
    if (!input.codeVerifier) {
      return null;
    }

    if (!verifyPkce(input.codeVerifier, entry.codeChallenge, entry.codeChallengeMethod)) {
      return null;
    }
  }

  return entry;
};

export const resetMcpOAuthStoreForTests = (): void => {
  authorizationCodes.clear();
  dynamicClients.clear();
};
