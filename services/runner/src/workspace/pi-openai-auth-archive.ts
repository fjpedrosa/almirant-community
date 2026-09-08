export const PI_OPENAI_AUTH_ROOT_DIRECTORY = "/run/almirant-pi-openai-auth";
export const PI_OPENAI_AUTH_STAGING_DIRECTORY = PI_OPENAI_AUTH_ROOT_DIRECTORY;
export const PI_OPENAI_AUTH_SEED_DIRECTORY =
  `${PI_OPENAI_AUTH_ROOT_DIRECTORY}/seed`;
export const PI_OPENAI_AUTH_SEED_PATH =
  `${PI_OPENAI_AUTH_SEED_DIRECTORY}/auth.json`;

export const PI_OPENAI_AUTH_SEED_ARCHIVE_DIRECTORY = "seed/";
export const PI_OPENAI_AUTH_SEED_ARCHIVE_FILE = "seed/auth.json";
export const PI_OPENAI_AUTH_ROOT_DIRECTORY_MODE = 0o711;
export const PI_OPENAI_AUTH_SEED_DIRECTORY_MODE = 0o700;
/** Compatibility alias for private child-owned directories. */
export const PI_OPENAI_AUTH_DIRECTORY_MODE = PI_OPENAI_AUTH_SEED_DIRECTORY_MODE;
export const PI_OPENAI_AUTH_FILE_MODE = 0o600;
export const PI_OPENAI_AUTH_SEED_FILE_UID = 1001;
export const PI_OPENAI_AUTH_SEED_FILE_GID = 1001;

export const PI_OPENAI_AUTH_FILE_MAX_BYTES = 96 * 1024;

const TAR_BLOCK_BYTES = 512;
const TAR_END_BYTES = TAR_BLOCK_BYTES * 2;
const MAX_OAUTH_TOKEN_LENGTH = 32_768;
const MAX_ACCOUNT_ID_LENGTH = 512;

const INVALID_ARCHIVE_ERROR = "Invalid Pi OpenAI auth archive";

export type PiOpenAiOAuthState = Readonly<{
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}>;

const invalidArchive = (): Error => new Error(INVALID_ARCHIVE_ERROR);

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length && keys.every(
    (key) => typeof key === "string" && expected.includes(key),
  );
};

const boundedNonEmptyString = (
  value: unknown,
  maxLength: number,
): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxLength &&
  value.trim() === value;

const parseOAuthState = (value: unknown): PiOpenAiOAuthState => {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["type", "access", "refresh", "expires", "accountId"]) ||
    value.type !== "oauth" ||
    !boundedNonEmptyString(value.access, MAX_OAUTH_TOKEN_LENGTH) ||
    !boundedNonEmptyString(value.refresh, MAX_OAUTH_TOKEN_LENGTH) ||
    typeof value.expires !== "number" ||
    !Number.isSafeInteger(value.expires) ||
    value.expires <= 0 ||
    !Number.isFinite(new Date(value.expires).getTime()) ||
    !boundedNonEmptyString(value.accountId, MAX_ACCOUNT_ID_LENGTH)
  ) {
    throw invalidArchive();
  }
  return Object.freeze({
    type: "oauth",
    access: value.access,
    refresh: value.refresh,
    expires: value.expires,
    accountId: value.accountId,
  });
};

const writeAscii = (
  target: Buffer,
  offset: number,
  length: number,
  value: string,
): void => {
  const bytes = Buffer.from(value, "ascii");
  if (bytes.length > length) throw invalidArchive();
  bytes.copy(target, offset);
};

const writeOctal = (
  target: Buffer,
  offset: number,
  length: number,
  value: number,
): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw invalidArchive();
  const octal = value.toString(8).padStart(length - 1, "0");
  if (octal.length !== length - 1) throw invalidArchive();
  writeAscii(target, offset, length, `${octal}\0`);
};

const checksum = (header: Uint8Array): number => {
  let sum = 0;
  for (const byte of header) sum += byte;
  return sum;
};

const createUstarHeader = (input: Readonly<{
  name: string;
  mode: number;
  uid: number;
  gid: number;
  size: number;
  type: "0" | "5";
}>): Buffer => {
  const header = Buffer.alloc(TAR_BLOCK_BYTES);
  writeAscii(header, 0, 100, input.name);
  writeOctal(header, 100, 8, input.mode);
  writeOctal(header, 108, 8, input.uid);
  writeOctal(header, 116, 8, input.gid);
  writeOctal(header, 124, 12, input.size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = input.type.charCodeAt(0);
  writeAscii(header, 257, 6, "ustar\0");
  writeAscii(header, 263, 2, "00");
  writeAscii(
    header,
    148,
    8,
    `${checksum(header).toString(8).padStart(6, "0")}\0 `,
  );
  return header;
};

const serializeSeedEnvelope = (state: PiOpenAiOAuthState): Buffer =>
  Buffer.from(JSON.stringify({
    "openai-codex": {
      type: state.type,
      access: state.access,
      refresh: state.refresh,
      expires: state.expires,
      accountId: state.accountId,
    },
  }), "utf8");

export const createPiOpenAiAuthSeedArchive = (value: unknown): Buffer => {
  let content: Buffer | undefined;
  let directoryHeader: Buffer | undefined;
  let fileHeader: Buffer | undefined;
  let padding: Buffer | undefined;
  let ending: Buffer | undefined;
  try {
    const state = parseOAuthState(value);
    content = serializeSeedEnvelope(state);
    if (content.length > PI_OPENAI_AUTH_FILE_MAX_BYTES) throw invalidArchive();
    directoryHeader = createUstarHeader({
      name: PI_OPENAI_AUTH_SEED_ARCHIVE_DIRECTORY,
      mode: PI_OPENAI_AUTH_SEED_DIRECTORY_MODE,
      uid: PI_OPENAI_AUTH_SEED_FILE_UID,
      gid: PI_OPENAI_AUTH_SEED_FILE_GID,
      size: 0,
      type: "5",
    });
    fileHeader = createUstarHeader({
      name: PI_OPENAI_AUTH_SEED_ARCHIVE_FILE,
      mode: PI_OPENAI_AUTH_FILE_MODE,
      uid: PI_OPENAI_AUTH_SEED_FILE_UID,
      gid: PI_OPENAI_AUTH_SEED_FILE_GID,
      size: content.length,
      type: "0",
    });
    padding = Buffer.alloc(
      (TAR_BLOCK_BYTES - (content.length % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES,
    );
    ending = Buffer.alloc(TAR_END_BYTES);
    return Buffer.concat([
      directoryHeader,
      fileHeader,
      content,
      padding,
      ending,
    ]);
  } catch {
    throw invalidArchive();
  } finally {
    content?.fill(0);
    directoryHeader?.fill(0);
    fileHeader?.fill(0);
    padding?.fill(0);
    ending?.fill(0);
  }
};
