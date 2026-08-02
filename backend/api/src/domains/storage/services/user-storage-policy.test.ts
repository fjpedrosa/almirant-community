import { describe, expect, it } from "bun:test";
import {
  DEFAULT_USER_STORAGE_QUOTA_BYTES,
  StorageQuotaExceededError,
  buildUserStorageObjectKey,
  normalizeUserStoragePath,
  reserveUserStorageBytes,
} from "./user-storage-policy";

describe("user storage policy", () => {
  it("uses a 1 GiB default quota", () => {
    expect(DEFAULT_USER_STORAGE_QUOTA_BYTES).toBe(1_073_741_824);
  });

  it("normalizes safe virtual paths without exposing the owner id in S3", () => {
    expect(normalizeUserStoragePath("reports/weekly summary.md")).toBe(
      "reports/weekly summary.md",
    );

    const key = buildUserStorageObjectKey({
      ownerUserId: "user@example.com",
      objectId: "8a569f44-d6e9-42d2-b7d8-e98d4f7777a1",
      fileName: "weekly summary.md",
    });

    expect(key).toMatch(
      /^user-storage\/[a-f0-9]{32}\/8a569f44-d6e9-42d2-b7d8-e98d4f7777a1\/weekly_summary\.md$/,
    );
    expect(key).not.toContain("user@example.com");
  });

  it.each([
    "../secret.txt",
    "folder/../../secret.txt",
    "/absolute.txt",
    "folder\\windows.txt",
    "folder//empty.txt",
    "folder/./dot.txt",
    "folder/\u0000bad.txt",
  ])("rejects unsafe path %s", (path) => {
    expect(() => normalizeUserStoragePath(path)).toThrow();
  });

  it("reserves bytes atomically against used and already-reserved capacity", () => {
    expect(
      reserveUserStorageBytes({
        quotaBytes: 100,
        usedBytes: 40,
        reservedBytes: 10,
        incomingBytes: 25,
      }),
    ).toEqual({ reservedBytes: 35, availableBytes: 25 });
  });

  it("throws a typed quota error instead of overcommitting", () => {
    expect(() =>
      reserveUserStorageBytes({
        quotaBytes: 100,
        usedBytes: 70,
        reservedBytes: 20,
        incomingBytes: 11,
      }),
    ).toThrow(StorageQuotaExceededError);
  });
});
