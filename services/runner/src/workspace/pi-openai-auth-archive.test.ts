import { describe, expect, it } from "bun:test";
import {
  PI_OPENAI_AUTH_FILE_MAX_BYTES,
  PI_OPENAI_AUTH_FILE_MODE,
  PI_OPENAI_AUTH_ROOT_DIRECTORY,
  PI_OPENAI_AUTH_ROOT_DIRECTORY_MODE,
  PI_OPENAI_AUTH_SEED_ARCHIVE_DIRECTORY,
  PI_OPENAI_AUTH_SEED_ARCHIVE_FILE,
  PI_OPENAI_AUTH_SEED_DIRECTORY,
  PI_OPENAI_AUTH_SEED_DIRECTORY_MODE,
  PI_OPENAI_AUTH_SEED_FILE_GID,
  PI_OPENAI_AUTH_SEED_FILE_UID,
  PI_OPENAI_AUTH_SEED_PATH,
  PI_OPENAI_AUTH_STAGING_DIRECTORY,
  createPiOpenAiAuthSeedArchive,
} from "./pi-openai-auth-archive";

const oauthState = () => ({
  type: "oauth" as const,
  access: "oauth-access-token",
  refresh: "oauth-refresh-token",
  expires: Date.parse("2026-05-01T13:00:00.000Z"),
  accountId: "account-123",
});

const octalField = (header: Buffer, offset: number, length: number): number =>
  Number.parseInt(header.subarray(offset, offset + length).toString("ascii").replace(/[\0 ]+$/u, ""), 8);

const headerName = (header: Buffer): string =>
  header.subarray(0, 100).toString("ascii").replace(/\0.*$/su, "");

describe("Pi OpenAI auth seed archive encoder", () => {
  it("freezes the root, staging, and child-private seed paths", () => {
    expect(PI_OPENAI_AUTH_ROOT_DIRECTORY).toBe("/run/almirant-pi-openai-auth");
    expect(PI_OPENAI_AUTH_ROOT_DIRECTORY_MODE).toBe(0o711);
    expect(PI_OPENAI_AUTH_STAGING_DIRECTORY).toBe(
      PI_OPENAI_AUTH_ROOT_DIRECTORY,
    );
    expect(PI_OPENAI_AUTH_SEED_DIRECTORY).toBe(
      "/run/almirant-pi-openai-auth/seed",
    );
    expect(PI_OPENAI_AUTH_SEED_PATH).toBe(
      "/run/almirant-pi-openai-auth/seed/auth.json",
    );
    expect(PI_OPENAI_AUTH_SEED_ARCHIVE_DIRECTORY).toBe("seed/");
    expect(PI_OPENAI_AUTH_SEED_ARCHIVE_FILE).toBe("seed/auth.json");
    for (const entry of [
      PI_OPENAI_AUTH_SEED_ARCHIVE_DIRECTORY,
      PI_OPENAI_AUTH_SEED_ARCHIVE_FILE,
    ]) {
      expect(entry.startsWith("/")).toBe(false);
      expect(entry.split("/")).not.toContain("..");
    }
  });

  it("writes one deterministic POSIX/USTAR seed directory and private auth file", () => {
    const first = createPiOpenAiAuthSeedArchive(oauthState());
    const second = createPiOpenAiAuthSeedArchive(oauthState());
    expect(first).toEqual(second);
    expect(first.length % 512).toBe(0);
    expect(first.length).toBeLessThanOrEqual(PI_OPENAI_AUTH_FILE_MAX_BYTES + 2048);

    const directoryHeader = first.subarray(0, 512);
    const fileHeader = first.subarray(512, 1024);
    expect(headerName(directoryHeader)).toBe(PI_OPENAI_AUTH_SEED_ARCHIVE_DIRECTORY);
    expect(directoryHeader[156]).toBe("5".charCodeAt(0));
    expect(octalField(directoryHeader, 100, 8)).toBe(PI_OPENAI_AUTH_SEED_DIRECTORY_MODE);
    expect(octalField(directoryHeader, 108, 8)).toBe(PI_OPENAI_AUTH_SEED_FILE_UID);
    expect(octalField(directoryHeader, 116, 8)).toBe(PI_OPENAI_AUTH_SEED_FILE_GID);
    expect(headerName(fileHeader)).toBe(PI_OPENAI_AUTH_SEED_ARCHIVE_FILE);
    expect(fileHeader[156]).toBe("0".charCodeAt(0));
    expect(octalField(fileHeader, 100, 8)).toBe(PI_OPENAI_AUTH_FILE_MODE);
    expect(octalField(fileHeader, 108, 8)).toBe(PI_OPENAI_AUTH_SEED_FILE_UID);
    expect(octalField(fileHeader, 116, 8)).toBe(PI_OPENAI_AUTH_SEED_FILE_GID);

    const size = octalField(fileHeader, 124, 12);
    expect(JSON.parse(first.subarray(1024, 1024 + size).toString("utf8"))).toEqual({
      "openai-codex": oauthState(),
    });
    expect(first.subarray(first.length - 1024)).toEqual(Buffer.alloc(1024));
  });

  it("fails closed on near-miss and traversal-shaped input without exposing secrets", () => {
    const privateToken = ` ${"x".repeat(32_768)}`;
    expect(() => createPiOpenAiAuthSeedArchive({
      ...oauthState(),
      archivePath: "../auth.json",
    })).toThrow("Invalid Pi OpenAI auth archive");

    let error: Error | undefined;
    try {
      createPiOpenAiAuthSeedArchive({ ...oauthState(), access: privateToken });
    } catch (caught) {
      error = caught as Error;
    }
    expect(error?.message).toBe("Invalid Pi OpenAI auth archive");
    expect(error?.message).not.toContain(privateToken);
  });
});
