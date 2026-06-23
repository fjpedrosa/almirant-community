import crypto from "node:crypto";

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
}

export const generatePKCE = async (): Promise<PKCEChallenge> => {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  const codeChallenge = hash.toString("base64url");

  return { codeVerifier, codeChallenge };
};
