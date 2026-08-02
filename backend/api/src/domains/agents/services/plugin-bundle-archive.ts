import { inflateRawSync } from "node:zlib";
import type { AgentPluginBundleFile } from "@almirant/shared";

export interface PluginBundleArchiveOptions {
  maxArchiveBytes?: number;
  maxFiles?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
}

export class PluginBundleArchiveError extends Error {
  readonly code = "INVALID_PLUGIN_BUNDLE_ARCHIVE";

  constructor(message: string) {
    super(message);
    this.name = "PluginBundleArchiveError";
  }
}

const DEFAULT_MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const ZIP64_U16 = 0xffff;
const ZIP64_U32 = 0xffffffff;
const CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/;
const WINDOWS_DRIVE_RE = /^[A-Za-z]:/;
const UNIX_FILE_TYPE_MASK = 0o170000;
const UNIX_REGULAR_FILE = 0o100000;
const UNIX_DIRECTORY = 0o040000;
const UNIX_SYMLINK = 0o120000;
const UNIX_SPECIAL_TYPES = new Set([0o010000, 0o020000, 0o060000, 0o140000]);

interface CentralEntry {
  name: string;
  nameBytes: Uint8Array;
  flags: number;
  method: number;
  checksum: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  directory: boolean;
}

const fail = (message: string): never => {
  throw new PluginBundleArchiveError(message);
};

const viewAt = (bytes: Uint8Array, offset: number, size: number): DataView => {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > bytes.byteLength) {
    return fail("Plugin ZIP contains a truncated record");
  }
  return new DataView(bytes.buffer, bytes.byteOffset + offset, size);
};

const decodeName = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("Plugin ZIP contains a non-UTF-8 entry name");
  }
};

const normalizeEntryPath = (rawName: string, directory: boolean): string => {
  const name = directory && rawName.endsWith("/") ? rawName.slice(0, -1) : rawName;
  if (
    !name ||
    name.startsWith("/") ||
    name.includes("\\") ||
    WINDOWS_DRIVE_RE.test(name) ||
    CONTROL_CHARACTER_RE.test(name)
  ) {
    return fail(`Plugin ZIP contains an unsafe entry path: ${rawName}`);
  }

  const segments = name.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return fail(`Plugin ZIP contains an unsafe entry path: ${rawName}`);
  }
  if (name.length > 512 || segments.some((segment) => segment.length > 128)) {
    return fail(`Plugin ZIP entry path is too long: ${rawName}`);
  }
  return segments.join("/");
};

const findEndOfCentralDirectory = (bytes: Uint8Array): number => {
  const minimumOffset = Math.max(0, bytes.byteLength - (22 + 0xffff));
  for (let offset = bytes.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (viewAt(bytes, offset, 4).getUint32(0, true) !== EOCD_SIGNATURE) continue;
    const record = viewAt(bytes, offset, 22);
    const commentLength = record.getUint16(20, true);
    if (offset + 22 + commentLength === bytes.byteLength) return offset;
  }
  return fail("Plugin bundle is not a valid ZIP archive");
};

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const readCentralEntries = (
  bytes: Uint8Array,
  options: Required<Pick<PluginBundleArchiveOptions, "maxFiles" | "maxTotalBytes" | "maxFileBytes">>,
): { entries: CentralEntry[]; centralOffset: number } => {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const eocd = viewAt(bytes, eocdOffset, 22);
  const diskNumber = eocd.getUint16(4, true);
  const centralDisk = eocd.getUint16(6, true);
  const entriesOnDisk = eocd.getUint16(8, true);
  const entryCount = eocd.getUint16(10, true);
  const centralSize = eocd.getUint32(12, true);
  const centralOffset = eocd.getUint32(16, true);

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === ZIP64_U16 ||
    centralSize === ZIP64_U32 ||
    centralOffset === ZIP64_U32
  ) {
    return fail("Multi-disk and ZIP64 plugin archives are not supported");
  }
  if (entryCount > options.maxFiles) {
    return fail(`Plugin ZIP cannot contain more than ${options.maxFiles} entries`);
  }
  if (centralOffset + centralSize > eocdOffset) {
    return fail("Plugin ZIP central directory is out of bounds");
  }

  const entries: CentralEntry[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;
  let cursor = centralOffset;
  const centralEnd = centralOffset + centralSize;

  for (let index = 0; index < entryCount; index += 1) {
    const fixed = viewAt(bytes, cursor, 46);
    if (fixed.getUint32(0, true) !== CENTRAL_SIGNATURE) {
      return fail("Plugin ZIP contains an invalid central-directory entry");
    }

    const versionMadeBy = fixed.getUint16(4, true);
    const hostSystem = versionMadeBy >>> 8;
    const flags = fixed.getUint16(8, true);
    const method = fixed.getUint16(10, true);
    const checksum = fixed.getUint32(16, true);
    const compressedSize = fixed.getUint32(20, true);
    const uncompressedSize = fixed.getUint32(24, true);
    const nameLength = fixed.getUint16(28, true);
    const extraLength = fixed.getUint16(30, true);
    const commentLength = fixed.getUint16(32, true);
    const startingDisk = fixed.getUint16(34, true);
    const externalAttributes = fixed.getUint32(38, true);
    const localOffset = fixed.getUint32(42, true);
    const variableLength = nameLength + extraLength + commentLength;

    if (
      startingDisk !== 0 ||
      compressedSize === ZIP64_U32 ||
      uncompressedSize === ZIP64_U32 ||
      localOffset === ZIP64_U32
    ) {
      return fail("Multi-disk and ZIP64 plugin archives are not supported");
    }
    if ((flags & ENCRYPTED_FLAG) !== 0) {
      return fail("Encrypted plugin ZIP entries are not supported");
    }
    if (method !== 0 && method !== 8) {
      return fail(`Plugin ZIP uses unsupported compression method ${method}`);
    }

    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    if (nameBytes.byteLength !== nameLength) {
      return fail("Plugin ZIP contains a truncated entry name");
    }
    const rawName = decodeName(nameBytes);
    const unixMode = externalAttributes >>> 16;
    const unixType = unixMode & UNIX_FILE_TYPE_MASK;
    const dosDirectory = (externalAttributes & 0x10) !== 0;
    const unixAttributesApply = hostSystem === 3 || hostSystem === 19;

    if (unixAttributesApply && unixType === UNIX_SYMLINK) {
      return fail("Plugin ZIP symbolic links are not allowed");
    }
    if (unixAttributesApply && UNIX_SPECIAL_TYPES.has(unixType)) {
      return fail("Plugin ZIP special files are not allowed");
    }
    if (
      unixAttributesApply &&
      unixType !== 0 &&
      unixType !== UNIX_REGULAR_FILE &&
      unixType !== UNIX_DIRECTORY
    ) {
      return fail("Plugin ZIP contains an unsupported Unix file type");
    }

    const directory = rawName.endsWith("/") || dosDirectory || (
      unixAttributesApply && unixType === UNIX_DIRECTORY
    );
    const name = normalizeEntryPath(rawName, directory);
    if (seenPaths.has(name)) {
      return fail(`Plugin ZIP contains duplicate entry path: ${name}`);
    }
    seenPaths.add(name);

    if (uncompressedSize > options.maxFileBytes) {
      return fail(`Plugin ZIP entry exceeds ${options.maxFileBytes} bytes: ${name}`);
    }
    totalBytes += uncompressedSize;
    if (totalBytes > options.maxTotalBytes) {
      return fail(`Plugin ZIP exceeds ${options.maxTotalBytes} uncompressed bytes`);
    }
    if (directory && (compressedSize !== 0 || uncompressedSize !== 0)) {
      return fail(`Plugin ZIP directory contains data: ${name}`);
    }

    entries.push({
      name,
      nameBytes: new Uint8Array(nameBytes),
      flags,
      method,
      checksum,
      compressedSize,
      uncompressedSize,
      localOffset,
      directory,
    });

    cursor += 46 + variableLength;
    if (cursor > centralEnd) {
      return fail("Plugin ZIP central directory is truncated");
    }
  }

  if (cursor !== centralEnd) {
    return fail("Plugin ZIP central directory contains unexpected trailing data");
  }
  return { entries, centralOffset };
};

const inflateEntry = (
  archive: Uint8Array,
  entry: CentralEntry,
  centralOffset: number,
  maxFileBytes: number,
): Uint8Array => {
  const local = viewAt(archive, entry.localOffset, 30);
  if (local.getUint32(0, true) !== LOCAL_SIGNATURE) {
    return fail(`Plugin ZIP has an invalid local header: ${entry.name}`);
  }

  const localFlags = local.getUint16(6, true);
  const localMethod = local.getUint16(8, true);
  const nameLength = local.getUint16(26, true);
  const extraLength = local.getUint16(28, true);
  const nameStart = entry.localOffset + 30;
  const nameBytes = archive.subarray(nameStart, nameStart + nameLength);
  if (
    (localFlags & (UTF8_FLAG | ENCRYPTED_FLAG)) !==
      (entry.flags & (UTF8_FLAG | ENCRYPTED_FLAG)) ||
    localMethod !== entry.method ||
    !bytesEqual(nameBytes, entry.nameBytes)
  ) {
    return fail(`Plugin ZIP local header does not match its catalog entry: ${entry.name}`);
  }

  const dataStart = nameStart + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > centralOffset || dataEnd > archive.byteLength) {
    return fail(`Plugin ZIP entry data is out of bounds: ${entry.name}`);
  }
  const compressed = archive.subarray(dataStart, dataEnd);

  let output: Uint8Array;
  try {
    if (entry.method === 0) {
      output = new Uint8Array(compressed);
    } else {
      output = new Uint8Array(
        inflateRawSync(compressed, {
          maxOutputLength: Math.min(maxFileBytes, entry.uncompressedSize) + 1,
        }),
      );
    }
  } catch {
    return fail(`Plugin ZIP entry could not be decompressed safely: ${entry.name}`);
  }

  if (output.byteLength !== entry.uncompressedSize) {
    return fail(`Plugin ZIP entry size does not match its declaration: ${entry.name}`);
  }
  if (crc32(output) !== entry.checksum) {
    return fail(`Plugin ZIP entry checksum is invalid: ${entry.name}`);
  }
  return output;
};

/**
 * Decodes only bounded, regular-file ZIP archives. No paths are written to disk.
 * ZIP64, encryption, links and device-like entries are deliberately rejected.
 */
export const decodePluginBundleZip = (
  archive: Uint8Array,
  options: PluginBundleArchiveOptions = {},
): AgentPluginBundleFile[] => {
  const limits = {
    maxArchiveBytes: options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
  };

  if (!(archive instanceof Uint8Array) || archive.byteLength === 0) {
    return fail("Plugin bundle ZIP is empty");
  }
  if (archive.byteLength > limits.maxArchiveBytes) {
    return fail(`Plugin bundle ZIP cannot exceed ${limits.maxArchiveBytes} bytes`);
  }

  const { entries, centralOffset } = readCentralEntries(archive, limits);
  return entries
    .filter((entry) => !entry.directory)
    .map((entry) => ({
      path: entry.name,
      content: inflateEntry(archive, entry, centralOffset, limits.maxFileBytes),
    }));
};
