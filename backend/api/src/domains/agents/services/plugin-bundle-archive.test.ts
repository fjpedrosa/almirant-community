import { describe, expect, it } from "bun:test";
import { deflateRawSync } from "node:zlib";
import {
  PluginBundleArchiveError,
  decodePluginBundleZip,
} from "./plugin-bundle-archive";

interface ZipEntryInput {
  name: string;
  content?: Uint8Array;
  compression?: "store" | "deflate";
  unixMode?: number;
  declaredUncompressedSize?: number;
  crcOverride?: number;
}

const text = (value: string) => new TextEncoder().encode(value);

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

const concat = (parts: Uint8Array[]): Uint8Array => {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

const makeZip = (entries: ZipEntryInput[]): Uint8Array => {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = text(entry.name);
    const content = entry.content ?? new Uint8Array();
    const method = entry.compression === "deflate" ? 8 : 0;
    const compressed = method === 8
      ? new Uint8Array(deflateRawSync(content))
      : content;
    const declaredSize = entry.declaredUncompressedSize ?? content.byteLength;
    const checksum = entry.crcOverride ?? crc32(content);

    const localHeader = new Uint8Array(30);
    const local = new DataView(localHeader.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, compressed.byteLength, true);
    local.setUint32(22, declaredSize, true);
    local.setUint16(26, name.byteLength, true);
    localParts.push(localHeader, name, compressed);

    const centralHeader = new Uint8Array(46);
    const central = new DataView(centralHeader.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, (3 << 8) | 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, method, true);
    central.setUint32(16, checksum, true);
    central.setUint32(20, compressed.byteLength, true);
    central.setUint32(24, declaredSize, true);
    central.setUint16(28, name.byteLength, true);
    central.setUint32(38, ((entry.unixMode ?? 0o100644) << 16) >>> 0, true);
    central.setUint32(42, localOffset, true);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.byteLength + name.byteLength + compressed.byteLength;
  }

  const localData = concat(localParts);
  const centralData = concat(centralParts);
  const eocd = new Uint8Array(22);
  const end = new DataView(eocd.buffer);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralData.byteLength, true);
  end.setUint32(16, localData.byteLength, true);
  return concat([localData, centralData, eocd]);
};

describe("plugin bundle ZIP decoder", () => {
  it("decodes stored and deflated regular files", () => {
    const result = decodePluginBundleZip(
      makeZip([
        { name: "SKILL.md", content: text("# Review") },
        {
          name: "references/checklist.md",
          content: text("- security"),
          compression: "deflate",
        },
      ]),
    );

    expect(result.map((file) => file.path)).toEqual([
      "SKILL.md",
      "references/checklist.md",
    ]);
    expect(new TextDecoder().decode(result[1]!.content)).toBe("- security");
  });

  it.each(["../escape", "/absolute", "folder/../../escape", "folder\\evil"])(
    "rejects unsafe entry path %s before extraction",
    (name) => {
      expect(() =>
        decodePluginBundleZip(makeZip([{ name, content: text("bad") }])),
      ).toThrow(PluginBundleArchiveError);
    },
  );

  it("rejects symlinks and special Unix files", () => {
    expect(() =>
      decodePluginBundleZip(
        makeZip([{ name: "link", content: text("target"), unixMode: 0o120777 }]),
      ),
    ).toThrow("symbolic links");

    expect(() =>
      decodePluginBundleZip(
        makeZip([{ name: "device", content: text(""), unixMode: 0o020666 }]),
      ),
    ).toThrow("special files");
  });

  it("enforces declared file-count and uncompressed-size limits before inflate", () => {
    expect(() =>
      decodePluginBundleZip(
        makeZip([
          { name: "SKILL.md", content: text("ok") },
          { name: "extra.txt", content: text("x") },
        ]),
        { maxFiles: 1 },
      ),
    ).toThrow("1 entries");

    expect(() =>
      decodePluginBundleZip(
        makeZip([
          {
            name: "SKILL.md",
            content: text("tiny"),
            declaredUncompressedSize: 101,
          },
        ]),
        { maxFileBytes: 100 },
      ),
    ).toThrow("100 bytes");
  });

  it("verifies entry checksums", () => {
    expect(() =>
      decodePluginBundleZip(
        makeZip([{ name: "SKILL.md", content: text("hello"), crcOverride: 1 }]),
      ),
    ).toThrow("checksum");
  });
});
