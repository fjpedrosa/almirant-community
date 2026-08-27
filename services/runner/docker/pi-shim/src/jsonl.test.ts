import { describe, expect, it } from "bun:test";
import {
  JsonlObjectParser,
  PiRpcProtocolError,
  serializeJsonlObject,
} from "./jsonl.js";

const fixturePath = `${import.meta.dir}/../../../test/fixtures/pi-0.84.2/rpc-framing-cases-v1.json`;

type FramingCase = {
  id: string;
  kind: "literal" | "sized-object";
  wire?: string;
  recordBytes?: number;
  expected: { accepted: boolean; records?: number; code?: string };
};

const exactSizedObject = (recordBytes: number): Uint8Array => {
  const overhead = Buffer.byteLength(JSON.stringify({ payload: "" }));
  return Buffer.from(`${JSON.stringify({ payload: "x".repeat(recordBytes - overhead) })}\n`);
};

const materialize = (testCase: FramingCase): Uint8Array =>
  testCase.kind === "literal"
    ? Buffer.from(testCase.wire ?? "", "utf8")
    : exactSizedObject(testCase.recordBytes ?? 0);

describe("JsonlObjectParser", () => {
  it("consumes every WU-1 framing fixture with frozen directional limits", async () => {
    const fixture = (await Bun.file(fixturePath).json()) as { cases: FramingCase[] };

    for (const testCase of fixture.cases) {
      const parser = new JsonlObjectParser({ maxRecordBytes: 262_144 });
      const wire = materialize(testCase);
      if (testCase.expected.accepted) {
        expect(parser.push(wire), testCase.id).toHaveLength(testCase.expected.records ?? 0);
        parser.end();
      } else {
        expect(() => {
          parser.push(wire);
          parser.end();
        }, testCase.id).toThrow(testCase.expected.code);
      }
    }
  });

  it("preserves LF framing across every chunk split and keeps U+2028/U+2029 as content", () => {
    const wire = Buffer.from('{"type":"event","text":"alpha\\u2028beta\\u2029gamma"}\r\n{"ok":true}\n');
    for (let split = 0; split <= wire.length; split += 1) {
      const parser = new JsonlObjectParser();
      const records = [
        ...parser.push(wire.subarray(0, split)),
        ...parser.push(wire.subarray(split)),
      ];
      parser.end();
      expect(records).toEqual([
        { type: "event", text: "alpha\u2028beta\u2029gamma" },
        { ok: true },
      ]);
    }
  });

  it("allows exactly 4,194,304 output bytes and poisons oversized or partial EOF sessions", () => {
    const max = 4_194_304;
    const parser = new JsonlObjectParser();
    expect(parser.push(exactSizedObject(max))).toHaveLength(1);
    parser.end();

    const oversized = new JsonlObjectParser();
    expect(() => oversized.push(exactSizedObject(max + 1))).toThrow("PI_RPC_RECORD_TOO_LARGE");
    expect(() => oversized.push(Buffer.from("{}\n"))).toThrow("PI_RPC_RECORD_TOO_LARGE");

    const partial = new JsonlObjectParser();
    partial.push(Buffer.from('{"type":"get_state"}'));
    expect(() => partial.end()).toThrow("PI_RPC_UNTERMINATED_RECORD");
  });

  it("poisons empty, malformed, non-object, and fatal UTF-8 records", () => {
    for (const [wire, code] of [
      [Buffer.from("\n"), "PI_RPC_MALFORMED_JSON"],
      [Buffer.from("{\n"), "PI_RPC_MALFORMED_JSON"],
      [Buffer.from("null\n"), "PI_RPC_NON_OBJECT"],
      [Buffer.from("[]\n"), "PI_RPC_NON_OBJECT"],
      [Buffer.from("7\n"), "PI_RPC_NON_OBJECT"],
      [Buffer.from([0xc3, 0x28, 0x0a]), "PI_RPC_MALFORMED_JSON"],
    ] as const) {
      const parser = new JsonlObjectParser();
      expect(() => parser.push(wire)).toThrow(code);
      expect(() => parser.end()).toThrow(code);
    }
  });
});

describe("serializeJsonlObject", () => {
  it("accepts objects only, enforces 262,144 record bytes, and appends mandatory LF", () => {
    const normal = serializeJsonlObject({ type: "prompt", message: "alpha\u2028beta\u2029gamma" });
    expect(normal.at(-1)).toBe(0x0a);
    expect(JSON.parse(Buffer.from(normal.subarray(0, -1)).toString("utf8"))).toEqual({
      type: "prompt",
      message: "alpha\u2028beta\u2029gamma",
    });

    const overhead = Buffer.byteLength(JSON.stringify({ payload: "" }));
    expect(serializeJsonlObject({ payload: "x".repeat(262_144 - overhead) })).toHaveLength(262_145);
    expect(() => serializeJsonlObject({ payload: "x".repeat(262_145 - overhead) })).toThrow(
      "PI_RPC_RECORD_TOO_LARGE",
    );
    for (const value of [null, [], "text", 1]) {
      expect(() => serializeJsonlObject(value)).toThrow("PI_RPC_NON_OBJECT");
    }
  });

  it("exposes stable typed protocol failures without payload contents", () => {
    try {
      serializeJsonlObject(null);
      throw new Error("expected serializer failure");
    } catch (error) {
      expect(error).toBeInstanceOf(PiRpcProtocolError);
      expect((error as PiRpcProtocolError).code).toBe("PI_RPC_NON_OBJECT");
      expect((error as Error).message).not.toContain("null");
    }
  });
});
