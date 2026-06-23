import { createHmac, timingSafeEqual } from "node:crypto";

interface OAuthStateTokenPayload {
  v: 1;
  provider: string;
  userId: string;
  codeVerifier: string | null;
  expiresAt: string;
}

const toBase64Url = (value: string): string =>
  Buffer.from(value, "utf-8").toString("base64url");

const fromBase64Url = (value: string): string =>
  Buffer.from(value, "base64url").toString("utf-8");

const signPayload = (payloadSegment: string, secret: string): string =>
  createHmac("sha256", secret).update(payloadSegment).digest("base64url");

export const createOAuthStateToken = (params: {
  provider: string;
  userId: string;
  codeVerifier: string | null;
  expiresAt: Date;
  secret: string;
}): string => {
  const payload: OAuthStateTokenPayload = {
    v: 1,
    provider: params.provider,
    userId: params.userId,
    codeVerifier: params.codeVerifier,
    expiresAt: params.expiresAt.toISOString(),
  };

  const payloadSegment = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadSegment, params.secret);

  return `${payloadSegment}.${signature}`;
};

export const verifyOAuthStateToken = (
  token: string,
  secret: string,
): OAuthStateTokenPayload | null => {
  const [payloadSegment, signatureSegment] = token.split(".");
  if (!payloadSegment || !signatureSegment) {
    return null;
  }

  const expectedSignature = signPayload(payloadSegment, secret);
  const provided = Buffer.from(signatureSegment);
  const expected = Buffer.from(expectedSignature);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return null;
  }

  const payload = JSON.parse(
    fromBase64Url(payloadSegment),
  ) as Partial<OAuthStateTokenPayload>;

  if (
    payload.v !== 1 ||
    typeof payload.provider !== "string" ||
    typeof payload.userId !== "string" ||
    (payload.codeVerifier !== null && typeof payload.codeVerifier !== "string") ||
    typeof payload.expiresAt !== "string"
  ) {
    return null;
  }

  const expiresAt = new Date(payload.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    return null;
  }

  return {
    v: 1,
    provider: payload.provider,
    userId: payload.userId,
    codeVerifier: payload.codeVerifier ?? null,
    expiresAt: payload.expiresAt,
  };
};
