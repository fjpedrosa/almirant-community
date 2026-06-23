import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export const encrypt = (
  plaintext: string,
  keyHex: string
): { encrypted: string; iv: string; authTag: string } => {
  const key = Buffer.from(keyHex, "hex");
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag().toString("base64");

  return {
    encrypted,
    iv: iv.toString("base64"),
    authTag,
  };
};

export const decrypt = (
  encrypted: string,
  iv: string,
  authTag: string,
  keyHex: string
): string => {
  const key = Buffer.from(keyHex, "hex");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));

  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
};
