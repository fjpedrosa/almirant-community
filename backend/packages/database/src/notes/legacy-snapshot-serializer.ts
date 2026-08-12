/**
 * Conversion limits are intentionally below the Lexical projector's 1 MiB
 * aggregate text budget. PostgreSQL performs the authoritative transfer-byte
 * preflight; this scanner validates the returned snapshot::text without ever
 * parsing JSONB numerics through JavaScript Number.
 */
export const MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES = 512 * 1024;
export const MAX_LEGACY_CONVERSION_DEPTH = 64;
export const MAX_LEGACY_CONVERSION_NODES = 10_000;
export const MAX_LEGACY_CONVERSION_STRING_BYTES = 512 * 1024;
export const MAX_LEGACY_CONVERSION_SERIALIZED_BYTES = 900_000;

const LIMIT_ERROR = "LEGACY_SNAPSHOT_TOO_LARGE";
const INVALID_ERROR = "LEGACY_SNAPSHOT_INVALID";

type ArrayState = "value-or-end" | "value" | "comma-or-end";
type ObjectState = "key-or-end" | "key" | "colon" | "value" | "comma-or-end";
type ContainerFrame =
  | { kind: "array"; state: ArrayState }
  | { kind: "object"; state: ObjectState };

const limit = (): never => {
  throw new Error(LIMIT_ERROR);
};

const invalid = (): never => {
  throw new Error(INVALID_ERROR);
};

const utf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
};

const isJsonWhitespace = (code: number): boolean =>
  code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;

const hexValue = (code: number): number => {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
};

/**
 * Validates one already-bounded PostgreSQL JSONB text value in constant call
 * stack space. It records no parsed values, so arbitrary-precision numeric
 * lexemes remain opaque and byte-for-byte unchanged.
 */
const validateJsonText = (text: string): void => {
  let index = 0;
  let nodeCount = 0;
  let totalStringBytes = 0;
  let rootStarted = false;
  const stack: ContainerFrame[] = [];

  const addStringBytes = (bytes: number, currentBytes: number): number => {
    const nextCurrent = currentBytes + bytes;
    totalStringBytes += bytes;
    if (
      nextCurrent > MAX_LEGACY_CONVERSION_STRING_BYTES
      || totalStringBytes > MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES
    ) {
      limit();
    }
    return nextCurrent;
  };

  const scanString = (): void => {
    if (text.charCodeAt(index) !== 0x22) invalid();
    index += 1;
    let stringBytes = 0;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        return;
      }
      if (code <= 0x1f) invalid();
      if (code === 0x5c) {
        const escape = text.charCodeAt(index + 1);
        if (
          escape === 0x22 || escape === 0x5c || escape === 0x2f
          || escape === 0x62 || escape === 0x66 || escape === 0x6e
          || escape === 0x72 || escape === 0x74
        ) {
          stringBytes = addStringBytes(1, stringBytes);
          index += 2;
          continue;
        }
        if (escape !== 0x75 || index + 5 >= text.length) invalid();
        let escapedCode = 0;
        for (let offset = 2; offset <= 5; offset += 1) {
          const digit = hexValue(text.charCodeAt(index + offset));
          if (digit < 0) invalid();
          escapedCode = escapedCode * 16 + digit;
        }
        index += 6;
        if (escapedCode >= 0xd800 && escapedCode <= 0xdbff) {
          if (
            text.charCodeAt(index) !== 0x5c
            || text.charCodeAt(index + 1) !== 0x75
            || index + 5 >= text.length
          ) {
            invalid();
          }
          let low = 0;
          for (let offset = 2; offset <= 5; offset += 1) {
            const digit = hexValue(text.charCodeAt(index + offset));
            if (digit < 0) invalid();
            low = low * 16 + digit;
          }
          if (low < 0xdc00 || low > 0xdfff) invalid();
          index += 6;
          stringBytes = addStringBytes(4, stringBytes);
        } else if (escapedCode >= 0xdc00 && escapedCode <= 0xdfff) {
          invalid();
        } else {
          stringBytes = addStringBytes(
            escapedCode <= 0x7f ? 1 : escapedCode <= 0x7ff ? 2 : 3,
            stringBytes,
          );
        }
        continue;
      }
      if (code <= 0x7f) {
        stringBytes = addStringBytes(1, stringBytes);
        index += 1;
      } else if (code <= 0x7ff) {
        stringBytes = addStringBytes(2, stringBytes);
        index += 1;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const low = text.charCodeAt(index + 1);
        if (low < 0xdc00 || low > 0xdfff) invalid();
        stringBytes = addStringBytes(4, stringBytes);
        index += 2;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        invalid();
      } else {
        stringBytes = addStringBytes(3, stringBytes);
        index += 1;
      }
    }
    invalid();
  };

  const scanDigits = (): number => {
    const start = index;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code < 0x30 || code > 0x39) break;
      index += 1;
    }
    return index - start;
  };

  const scanNumber = (): void => {
    if (text.charCodeAt(index) === 0x2d) index += 1;
    const first = text.charCodeAt(index);
    if (first === 0x30) {
      index += 1;
    } else if (first >= 0x31 && first <= 0x39) {
      scanDigits();
    } else {
      invalid();
    }
    if (text.charCodeAt(index) === 0x2e) {
      index += 1;
      if (scanDigits() === 0) invalid();
    }
    const exponent = text.charCodeAt(index);
    if (exponent === 0x65 || exponent === 0x45) {
      index += 1;
      const sign = text.charCodeAt(index);
      if (sign === 0x2b || sign === 0x2d) index += 1;
      if (scanDigits() === 0) invalid();
    }
  };

  const scanLiteral = (literal: string): void => {
    for (let offset = 0; offset < literal.length; offset += 1) {
      if (text.charCodeAt(index + offset) !== literal.charCodeAt(offset)) invalid();
    }
    index += literal.length;
  };

  const startValue = (): void => {
    nodeCount += 1;
    if (nodeCount > MAX_LEGACY_CONVERSION_NODES) limit();
    const code = text.charCodeAt(index);
    if (code === 0x22) {
      scanString();
    } else if (code === 0x7b || code === 0x5b) {
      // The root container is depth zero; every already-open container adds
      // one level for the new value.
      if (stack.length > MAX_LEGACY_CONVERSION_DEPTH) limit();
      index += 1;
      stack.push(code === 0x7b
        ? { kind: "object", state: "key-or-end" }
        : { kind: "array", state: "value-or-end" });
    } else if (code === 0x74) {
      scanLiteral("true");
    } else if (code === 0x66) {
      scanLiteral("false");
    } else if (code === 0x6e) {
      scanLiteral("null");
    } else if (code === 0x2d || (code >= 0x30 && code <= 0x39)) {
      scanNumber();
    } else {
      invalid();
    }
  };

  const skipWhitespace = (): void => {
    while (index < text.length && isJsonWhitespace(text.charCodeAt(index))) index += 1;
  };

  while (true) {
    skipWhitespace();
    if (!rootStarted) {
      if (index >= text.length) invalid();
      rootStarted = true;
      startValue();
      continue;
    }
    if (stack.length === 0) {
      if (index !== text.length) invalid();
      return;
    }

    const frame = stack[stack.length - 1]!;
    const code = text.charCodeAt(index);
    if (frame.kind === "array") {
      if (frame.state === "value-or-end") {
        if (code === 0x5d) {
          index += 1;
          stack.pop();
        } else {
          frame.state = "comma-or-end";
          startValue();
        }
      } else if (frame.state === "value") {
        frame.state = "comma-or-end";
        startValue();
      } else if (code === 0x2c) {
        index += 1;
        frame.state = "value";
      } else if (code === 0x5d) {
        index += 1;
        stack.pop();
      } else {
        invalid();
      }
      continue;
    }

    if (frame.state === "key-or-end") {
      if (code === 0x7d) {
        index += 1;
        stack.pop();
      } else {
        scanString();
        frame.state = "colon";
      }
    } else if (frame.state === "key") {
      scanString();
      frame.state = "colon";
    } else if (frame.state === "colon") {
      if (code !== 0x3a) invalid();
      index += 1;
      frame.state = "value";
    } else if (frame.state === "value") {
      frame.state = "comma-or-end";
      startValue();
    } else if (code === 0x2c) {
      index += 1;
      frame.state = "key";
    } else if (code === 0x7d) {
      index += 1;
      stack.pop();
    } else {
      invalid();
    }
  }
};

export const serializeLegacySnapshotForConversion = (snapshotText: string): string => {
  try {
    if (typeof snapshotText !== "string") invalid();
    const bytes = utf8ByteLength(snapshotText);
    if (
      bytes > MAX_LEGACY_CONVERSION_SNAPSHOT_BYTES
      || bytes > MAX_LEGACY_CONVERSION_SERIALIZED_BYTES
    ) {
      limit();
    }
    validateJsonText(snapshotText);
    return snapshotText;
  } catch (error) {
    if (error instanceof Error && (error.message === LIMIT_ERROR || error.message === INVALID_ERROR)) {
      throw error;
    }
    throw new Error(INVALID_ERROR);
  }
};
