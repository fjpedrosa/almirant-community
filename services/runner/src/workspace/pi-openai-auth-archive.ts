import { createHash, timingSafeEqual } from "node:crypto";

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
const ARCHIVE_MAX_BYTES = 128 * 1024;
const ARCHIVE_TIMEOUT_MS = 5_000;
const MAX_ARCHIVE_TIMEOUT_MS = 30_000;
const CAPTURED_FILENAME = "rotated-auth.json";
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

const parseExactEnvelope = (bytes: Uint8Array): PiOpenAiOAuthState => {
  let canonical: Buffer | undefined;
  try {
    if (bytes.byteLength === 0 || bytes.byteLength > PI_OPENAI_AUTH_FILE_MAX_BYTES) {
      throw invalidArchive();
    }
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
    if (!isPlainRecord(value) || !hasExactKeys(value, ["openai-codex"])) {
      throw invalidArchive();
    }
    const state = parseOAuthState(value["openai-codex"]);
    canonical = serializeSeedEnvelope(state);
    const observed = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (canonical.length !== observed.length || !canonical.equals(observed)) {
      throw invalidArchive();
    }
    return state;
  } catch {
    throw invalidArchive();
  } finally {
    canonical?.fill(0);
  }
};

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

const destroyStream = (stream: NodeJS.ReadableStream): void => {
  try {
    (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
  } catch {
    // The generic archive failure remains authoritative.
  }
};

const positiveBoundedInteger = (value: number, maximum: number): number => {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidArchive();
  return Math.min(value, maximum);
};

const readBoundedArchive = async (
  stream: NodeJS.ReadableStream,
  options: Readonly<{ timeoutMs?: number; maxBytes?: number }> | undefined,
): Promise<Buffer> => {
  const maxBytes = positiveBoundedInteger(
    options?.maxBytes ?? ARCHIVE_MAX_BYTES,
    ARCHIVE_MAX_BYTES,
  );
  const timeoutMs = positiveBoundedInteger(
    options?.timeoutMs ?? ARCHIVE_TIMEOUT_MS,
    MAX_ARCHIVE_TIMEOUT_MS,
  );
  const chunks: Buffer[] = [];
  let total = 0;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const zeroChunks = (): void => {
    for (const chunk of chunks) chunk.fill(0);
    chunks.length = 0;
  };
  const read = async (): Promise<Buffer> => {
    try {
      for await (const chunk of stream as AsyncIterable<unknown>) {
        if (!(chunk instanceof Uint8Array)) throw invalidArchive();
        if (chunk.byteLength > maxBytes - total) {
          chunk.fill(0);
          throw invalidArchive();
        }
        const bytes = Buffer.from(chunk);
        try {
          chunk.fill(0);
        } catch {
          bytes.fill(0);
          throw invalidArchive();
        }
        if (timedOut) {
          bytes.fill(0);
          throw invalidArchive();
        }
        total += bytes.length;
        chunks.push(bytes);
      }
      return Buffer.concat(chunks, total);
    } finally {
      zeroChunks();
    }
  };
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      zeroChunks();
      destroyStream(stream);
      reject(invalidArchive());
    }, timeoutMs);
  });

  try {
    return await Promise.race([read(), timeout]);
  } catch {
    destroyStream(stream);
    throw invalidArchive();
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const allZero = (bytes: Uint8Array): boolean => {
  for (const byte of bytes) {
    if (byte !== 0) return false;
  }
  return true;
};

const parseCanonicalOctal = (field: Uint8Array): number => {
  if (field.length < 2 || field[field.length - 1] !== 0) throw invalidArchive();
  let value = 0;
  for (let index = 0; index < field.length - 1; index += 1) {
    const byte = field[index]!;
    if (byte < 0x30 || byte > 0x37) throw invalidArchive();
    value = value * 8 + byte - 0x30;
  }
  if (!Number.isSafeInteger(value)) throw invalidArchive();
  return value;
};

const exactAscii = (
  bytes: Uint8Array,
  offset: number,
  value: string,
): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
};

const exactHeaderName = (header: Buffer): boolean => {
  if (!exactAscii(header, 0, CAPTURED_FILENAME)) return false;
  return allZero(header.subarray(CAPTURED_FILENAME.length, 100));
};

const validHeaderChecksum = (header: Buffer): boolean => {
  if (header[154] !== 0 || header[155] !== 0x20) return false;
  let copy: Buffer | undefined;
  try {
    const expected = parseCanonicalOctal(header.subarray(148, 155));
    copy = Buffer.from(header);
    copy.fill(0x20, 148, 156);
    return checksum(copy) === expected;
  } finally {
    copy?.fill(0);
  }
};

const parseCaptureTar = (archive: Buffer): Buffer => {
  if (
    archive.length < TAR_BLOCK_BYTES + TAR_END_BYTES ||
    archive.length % TAR_BLOCK_BYTES !== 0
  ) {
    throw invalidArchive();
  }
  const header = archive.subarray(0, TAR_BLOCK_BYTES);
  if (
    allZero(header) ||
    !validHeaderChecksum(header) ||
    !exactHeaderName(header) ||
    header[156] !== 0x30 ||
    !exactAscii(header, 257, "ustar\0") ||
    !exactAscii(header, 263, "00") ||
    !allZero(header.subarray(157, 257)) ||
    !allZero(header.subarray(345, TAR_BLOCK_BYTES))
  ) {
    throw invalidArchive();
  }

  const mode = parseCanonicalOctal(header.subarray(100, 108));
  const uid = parseCanonicalOctal(header.subarray(108, 116));
  const gid = parseCanonicalOctal(header.subarray(116, 124));
  const size = parseCanonicalOctal(header.subarray(124, 136));
  parseCanonicalOctal(header.subarray(136, 148));
  const devmajor = parseCanonicalOctal(header.subarray(329, 337));
  const devminor = parseCanonicalOctal(header.subarray(337, 345));
  if (
    mode !== PI_OPENAI_AUTH_FILE_MODE || uid !== 0 || gid !== 0 ||
    devmajor !== 0 || devminor !== 0 ||
    size <= 0 || size > PI_OPENAI_AUTH_FILE_MAX_BYTES
  ) {
    throw invalidArchive();
  }

  const bodyStart = TAR_BLOCK_BYTES;
  const bodyEnd = bodyStart + size;
  const paddingEnd = bodyStart + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  if (
    archive.length < paddingEnd + TAR_END_BYTES ||
    bodyEnd > paddingEnd ||
    !allZero(archive.subarray(bodyEnd, paddingEnd)) ||
    !allZero(archive.subarray(paddingEnd))
  ) {
    throw invalidArchive();
  }
  return Buffer.from(archive.subarray(bodyStart, bodyEnd));
};

const accountDigest = (accountId: string): Buffer =>
  createHash("sha256").update(accountId, "utf8").digest();

export const parsePiOpenAiAuthCaptureArchive = async (
  stream: NodeJS.ReadableStream,
  expectedAccountId: string,
  options?: Readonly<{ timeoutMs?: number; maxBytes?: number }>,
): Promise<PiOpenAiOAuthState> => {
  let archive: Buffer | undefined;
  let content: Buffer | undefined;
  try {
    if (!boundedNonEmptyString(expectedAccountId, MAX_ACCOUNT_ID_LENGTH)) {
      throw invalidArchive();
    }
    archive = await readBoundedArchive(stream, options);
    content = parseCaptureTar(archive);
    const state = parseExactEnvelope(content);
    let capturedDigest: Buffer | undefined;
    let expectedDigest: Buffer | undefined;
    try {
      capturedDigest = accountDigest(state.accountId);
      expectedDigest = accountDigest(expectedAccountId);
      if (!timingSafeEqual(capturedDigest, expectedDigest)) throw invalidArchive();
    } finally {
      capturedDigest?.fill(0);
      expectedDigest?.fill(0);
    }
    return state;
  } catch {
    throw invalidArchive();
  } finally {
    content?.fill(0);
    archive?.fill(0);
    content = undefined;
    archive = undefined;
  }
};
