import { describe, expect, spyOn, test } from "bun:test";
import { Readable } from "node:stream";
import { parsePiOpenAiAuthCaptureArchive } from "./pi-openai-auth-archive";

const INVALID = "Invalid Pi OpenAI auth archive";
const ACCOUNT = "acct-capture";
const STATE = Object.freeze({
  type: "oauth" as const,
  access: "access-secret",
  refresh: "refresh-secret",
  expires: 4_102_444_800_000,
  accountId: ACCOUNT,
});
const BLOCK = 512;

const writeOctal = (
  target: Buffer,
  offset: number,
  length: number,
  value: number,
): void => {
  target.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
};

const repairChecksum = (header: Buffer): void => {
  header.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
};

const envelope = (state: Record<string, unknown> = STATE): Buffer =>
  Buffer.from(JSON.stringify({ "openai-codex": state }), "utf8");

const header = (size: number): Buffer => {
  const value = Buffer.alloc(BLOCK);
  value.write("rotated-auth.json", 0, "ascii");
  writeOctal(value, 100, 8, 0o600);
  writeOctal(value, 108, 8, 0);
  writeOctal(value, 116, 8, 0);
  writeOctal(value, 124, 12, size);
  writeOctal(value, 136, 12, 0);
  value[156] = 0x30;
  value.write("ustar\0", 257, 6, "ascii");
  value.write("00", 263, 2, "ascii");
  value.write("root", 265, "ascii");
  value.write("root", 297, "ascii");
  writeOctal(value, 329, 8, 0);
  writeOctal(value, 337, 8, 0);
  repairChecksum(value);
  return value;
};

const archive = (body = envelope(), endBlocks = 3): Buffer => Buffer.concat([
  header(body.length),
  body,
  Buffer.alloc((BLOCK - body.length % BLOCK) % BLOCK),
  Buffer.alloc(BLOCK * endBlocks),
]);

const allZero = (bytes: Uint8Array): boolean => bytes.every((byte) => byte === 0);

const expectInvalid = async (
  bytes: Buffer,
  expectedAccountId = ACCOUNT,
  expectConsumed = true,
): Promise<void> => {
  const chunk = Buffer.from(bytes);
  let failure: unknown;
  try {
    await parsePiOpenAiAuthCaptureArchive(Readable.from([chunk]), expectedAccountId);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toBe(INVALID);
  if (expectConsumed) expect(allZero(chunk)).toBeTrue();
};

const editHeader = (
  bytes: Buffer,
  edit: (value: Buffer) => void,
  checksum = true,
): Buffer => {
  const changed = Buffer.from(bytes);
  edit(changed.subarray(0, BLOCK));
  if (checksum) repairChecksum(changed.subarray(0, BLOCK));
  return changed;
};

describe("parsePiOpenAiAuthCaptureArchive", () => {
  test("returns frozen state and zeroes consumed binary chunks", async () => {
    const chunk = archive(envelope(), 2);
    const result = await parsePiOpenAiAuthCaptureArchive(
      Readable.from([chunk]),
      ACCOUNT,
    );

    expect(result).toEqual(STATE);
    expect(Object.isFrozen(result)).toBeTrue();
    expect(allZero(chunk)).toBeTrue();
  });

  test("accepts a canonical nonzero non-authoritative mtime", async () => {
    const chunk = editHeader(
      archive(),
      (value) => writeOctal(value, 136, 12, 1_700_000_000),
    );
    const result = await parsePiOpenAiAuthCaptureArchive(
      Readable.from([chunk]),
      ACCOUNT,
    );
    expect(result).toEqual(STATE);
    expect(allZero(chunk)).toBeTrue();
  });

  test("times out, destroys the stream, and zeroes retained and late chunks", async () => {
    const first = Buffer.from("first-secret");
    const late = Buffer.from("late-secret");
    let destroyed = false;
    const stream = {
      destroy: () => { destroyed = true; },
      async *[Symbol.asyncIterator]() {
        yield first;
        await Bun.sleep(20);
        yield late;
      },
    } as unknown as NodeJS.ReadableStream;

    await expect(
      parsePiOpenAiAuthCaptureArchive(stream, ACCOUNT, { timeoutMs: 5 }),
    ).rejects.toThrow(INVALID);
    expect(destroyed).toBeTrue();
    expect(allZero(first)).toBeTrue();
    await Bun.sleep(30);
    expect(allZero(late)).toBeTrue();
  });

  test("rejects overflow at the hard cap and destroys and zeroes input", async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    const stream = Readable.from([chunk]);
    using bufferFromSpy = spyOn(Buffer, "from");
    await expect(
      parsePiOpenAiAuthCaptureArchive(stream, ACCOUNT, {
        maxBytes: Number.MAX_SAFE_INTEGER,
      }),
    ).rejects.toThrow(INVALID);
    expect(bufferFromSpy).not.toHaveBeenCalledWith(chunk);
    expect(stream.destroyed).toBeTrue();
    expect(allZero(chunk)).toBeTrue();
  });

  test("rejects stream errors and non-binary chunks without leaking details", async () => {
    const secret = "stream-refresh-secret";
    const chunk = Buffer.from(secret);
    for (const values of [[chunk, new Error(secret)], [secret]] as const) {
      let destroyed = false;
      const stream = {
        destroy: () => { destroyed = true; },
        async *[Symbol.asyncIterator]() {
          for (const value of values) {
            if (value instanceof Error) throw value;
            yield value;
          }
        },
      } as unknown as NodeJS.ReadableStream;
      let failure: unknown;
      try {
        await parsePiOpenAiAuthCaptureArchive(stream, ACCOUNT);
      } catch (error) {
        failure = error;
      }
      expect((failure as Error).message).toBe(INVALID);
      expect(String(failure)).not.toContain(secret);
      expect(destroyed).toBeTrue();
    }
    expect(allZero(chunk)).toBeTrue();
  });

  const tarCases: ReadonlyArray<readonly [string, (value: Buffer) => Buffer]> = [
    ["checksum", (value) => editHeader(value, (h) => { h[0]! ^= 1; }, false)],
    ["framing", (value) => value.subarray(0, value.length - 1)],
    ["wrong name", (value) => editHeader(value, (h) => h.write("other.json\0", 0, "ascii"))],
    ["traversal name", (value) => editHeader(value, (h) => h.write("../rotated-auth.json\0", 0, "ascii"))],
    ["extra entry", (value) => Buffer.concat([value.subarray(0, value.length - 1024), header(1), Buffer.alloc(512), Buffer.alloc(1024)])],
    ["magic", (value) => editHeader(value, (h) => { h[257] = 0x78; })],
    ["version", (value) => editHeader(value, (h) => { h[263] = 0x31; })],
    ["link name", (value) => editHeader(value, (h) => { h[157] = 1; })],
    ["nonzero devmajor", (value) => editHeader(value, (h) => writeOctal(h, 329, 8, 1))],
    ["nonzero devminor", (value) => editHeader(value, (h) => writeOctal(h, 337, 8, 1))],
    ["malformed device octal", (value) => editHeader(value, (h) => { h[329] = 0x38; })],
    ["prefix", (value) => editHeader(value, (h) => { h[345] = 1; })],
    ["malformed mtime octal", (value) => editHeader(value, (h) => { h[136] = 0x38; })],
    ["noncanonical mtime octal", (value) => editHeader(value, (h) => h.write("          1\0", 136, 12, "ascii"))],
    ["null type", (value) => editHeader(value, (h) => { h[156] = 0; })],
    ["mode", (value) => editHeader(value, (h) => writeOctal(h, 100, 8, 0o644))],
    ["UID", (value) => editHeader(value, (h) => writeOctal(h, 108, 8, 1))],
    ["GID", (value) => editHeader(value, (h) => writeOctal(h, 116, 8, 1))],
    ["zero size", (value) => editHeader(value, (h) => writeOctal(h, 124, 12, 0))],
    ["oversized size", (value) => editHeader(value, (h) => writeOctal(h, 124, 12, 96 * 1024 + 1))],
    ["invalid octal", (value) => editHeader(value, (h) => { h[100] = 0x38; })],
    ["padding", (value) => { const changed = Buffer.from(value); changed[BLOCK + envelope().length] = 1; return changed; }],
    ["nonzero trailing byte", (value) => { const changed = Buffer.from(value); changed[changed.length - 1] = 1; return changed; }],
  ];

  for (const [name, mutate] of tarCases) {
    test(`rejects non-canonical tar: ${name}`, () => expectInvalid(mutate(archive())));
  }

  const jsonCases: ReadonlyArray<readonly [string, Buffer]> = [
    ["fatal UTF-8", Buffer.from([0xff])],
    ["whitespace", Buffer.concat([envelope(), Buffer.from("\n")])],
    ["duplicate key", Buffer.from('{"openai-codex":{"type":"oauth","access":"access-secret","refresh":"refresh-secret","expires":4102444800000,"accountId":"acct-capture","accountId":"acct-capture"}}')],
    ["extra envelope key", Buffer.from(JSON.stringify({ "openai-codex": STATE, extra: true }))],
    ["extra state key", envelope({ ...STATE, extra: true })],
    ["wrong type", envelope({ ...STATE, type: "api" })],
    ["empty access", envelope({ ...STATE, access: "" })],
    ["oversized access", envelope({ ...STATE, access: "x".repeat(32_769) })],
    ["empty refresh", envelope({ ...STATE, refresh: "" })],
    ["oversized refresh", envelope({ ...STATE, refresh: "x".repeat(32_769) })],
    ["invalid expiry", envelope({ ...STATE, expires: 0 })],
    ["fractional expiry", envelope({ ...STATE, expires: 1.5 })],
    ["empty account", envelope({ ...STATE, accountId: "" })],
    ["whitespace account", envelope({ ...STATE, accountId: ` ${ACCOUNT}` })],
    ["oversized account", envelope({ ...STATE, accountId: "x".repeat(513) })],
  ];

  for (const [name, body] of jsonCases) {
    test(`rejects invalid state bytes: ${name}`, () => expectInvalid(archive(body)));
  }

  test("rejects account mismatch and invalid expected-account bounds", async () => {
    await expectInvalid(archive(), "another-account");
    for (const expected of ["", ` ${ACCOUNT}`, "x".repeat(513)]) {
      await expectInvalid(archive(), expected, false);
    }
  });

  test("uses one generic secret-safe error for archive validation failures", async () => {
    const secret = "raw-refresh-secret-must-not-escape";
    let failure: unknown;
    try {
      await parsePiOpenAiAuthCaptureArchive(
        Readable.from([archive(envelope({ ...STATE, refresh: secret, extra: true }))]),
        ACCOUNT,
      );
    } catch (error) {
      failure = error;
    }
    expect((failure as Error).message).toBe(INVALID);
    expect(String(failure)).not.toContain(secret);
  });
});
