export const PI_STDOUT_RECORD_MAX_BYTES = 4_194_304;
export const PI_STDIN_RECORD_MAX_BYTES = 262_144;

export type PiRpcProtocolErrorCode =
  | "PI_RPC_MALFORMED_JSON"
  | "PI_RPC_NON_OBJECT"
  | "PI_RPC_RECORD_TOO_LARGE"
  | "PI_RPC_UNTERMINATED_RECORD"
  | "PI_RPC_PROTOCOL_ERROR";

export class PiRpcProtocolError extends Error {
  public readonly code: PiRpcProtocolErrorCode;

  constructor(code: PiRpcProtocolErrorCode, safeDetail: string) {
    super(`${code}: ${safeDetail}`);
    this.name = "PiRpcProtocolError";
    this.code = code;
  }
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const concatBytes = (left: Uint8Array, right: Uint8Array): Uint8Array => {
  if (left.length === 0) return Uint8Array.from(right);
  if (right.length === 0) return left;
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
};

export class JsonlObjectParser {
  private readonly maxRecordBytes: number;
  private pending: Uint8Array = new Uint8Array(0);
  private poisoned: PiRpcProtocolError | null = null;
  private ended = false;

  constructor(options: { maxRecordBytes?: number } = {}) {
    this.maxRecordBytes = options.maxRecordBytes ?? PI_STDOUT_RECORD_MAX_BYTES;
    if (!Number.isSafeInteger(this.maxRecordBytes) || this.maxRecordBytes < 1) {
      throw new PiRpcProtocolError("PI_RPC_PROTOCOL_ERROR", "invalid record limit");
    }
  }

  public push(chunk: Uint8Array): Record<string, unknown>[] {
    this.assertUsable();
    if (this.ended) {
      return this.fail("PI_RPC_PROTOCOL_ERROR", "bytes received after stream end");
    }

    this.pending = concatBytes(this.pending, chunk);
    const records: Record<string, unknown>[] = [];

    for (;;) {
      const newlineIndex = this.pending.indexOf(0x0a);
      if (newlineIndex < 0) {
        const mayOnlyHaveCrlfSuffix =
          this.pending.length === this.maxRecordBytes + 1 &&
          this.pending.at(-1) === 0x0d;
        if (this.pending.length > this.maxRecordBytes && !mayOnlyHaveCrlfSuffix) {
          return this.fail("PI_RPC_RECORD_TOO_LARGE", "record exceeds byte limit");
        }
        return records;
      }

      let recordEnd = newlineIndex;
      if (recordEnd > 0 && this.pending[recordEnd - 1] === 0x0d) recordEnd -= 1;
      if (recordEnd > this.maxRecordBytes) {
        return this.fail("PI_RPC_RECORD_TOO_LARGE", "record exceeds byte limit");
      }
      if (recordEnd === 0) {
        return this.fail("PI_RPC_MALFORMED_JSON", "empty record");
      }

      const recordBytes = this.pending.subarray(0, recordEnd);
      this.pending = this.pending.slice(newlineIndex + 1);

      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(recordBytes);
      } catch {
        return this.fail("PI_RPC_MALFORMED_JSON", "record is not valid UTF-8");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return this.fail("PI_RPC_MALFORMED_JSON", "record is not valid JSON");
      }
      if (!isObjectRecord(parsed)) {
        return this.fail("PI_RPC_NON_OBJECT", "record must be a JSON object");
      }
      records.push(parsed);
    }
  }

  public end(): void {
    this.assertUsable();
    this.ended = true;
    if (this.pending.length > 0) {
      this.fail("PI_RPC_UNTERMINATED_RECORD", "stream ended without final LF");
    }
  }

  private assertUsable(): void {
    if (this.poisoned) throw this.poisoned;
  }

  private fail(code: PiRpcProtocolErrorCode, detail: string): never {
    this.poisoned ??= new PiRpcProtocolError(code, detail);
    throw this.poisoned;
  }
}

export const serializeJsonlObject = (
  value: unknown,
  maxRecordBytes = PI_STDIN_RECORD_MAX_BYTES,
): Uint8Array => {
  if (!isObjectRecord(value)) {
    throw new PiRpcProtocolError("PI_RPC_NON_OBJECT", "outbound value must be a JSON object");
  }

  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    throw new PiRpcProtocolError("PI_RPC_MALFORMED_JSON", "outbound object is not serializable");
  }
  if (typeof json !== "string") {
    throw new PiRpcProtocolError("PI_RPC_MALFORMED_JSON", "outbound object is not serializable");
  }

  const record = new TextEncoder().encode(json);
  if (record.length > maxRecordBytes) {
    throw new PiRpcProtocolError("PI_RPC_RECORD_TOO_LARGE", "outbound record exceeds byte limit");
  }

  const wire = new Uint8Array(record.length + 1);
  wire.set(record);
  wire[record.length] = 0x0a;
  return wire;
};
