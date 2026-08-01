import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Capture the real modules BEFORE registering mocks so we can restore them in
// afterAll — mock.restore() does NOT clear mock.module() registrations and the
// mocks would otherwise leak into subsequent test files.
const realConfig = { ...(await import("@almirant/config")) };
const realDatabase = { ...(await import("@almirant/database")) };
const realS3Service = { ...(await import("./s3-service")) };

const THUM_IO_API_KEY = "super-secret-thumio-key";

const loggerCalls: {
  info: Array<[Record<string, unknown>, string]>;
  error: Array<[Record<string, unknown>, string]>;
  warn: Array<[Record<string, unknown>, string]>;
} = { info: [], error: [], warn: [] };

const dbUpdateCalls: Array<Record<string, unknown>> = [];

mock.module("@almirant/config", () => ({
  env: { THUM_IO_API_KEY },
  logger: {
    info: (fields: Record<string, unknown>, message: string) => {
      loggerCalls.info.push([fields, message]);
    },
    error: (fields: Record<string, unknown>, message: string) => {
      loggerCalls.error.push([fields, message]);
    },
    warn: (fields: Record<string, unknown>, message: string) => {
      loggerCalls.warn.push([fields, message]);
    },
    debug: () => undefined,
  },
}));

mock.module("@almirant/database", () => ({
  db: {
    update: (_table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (_condition: unknown) => {
          dbUpdateCalls.push(values);
        },
      }),
    }),
  },
  schema: { projects: { id: "id" } },
  eq: (...args: unknown[]) => ({ args }),
}));

mock.module("./s3-service", () => ({
  isS3Configured: () => true,
  uploadBufferToS3: async (_buffer: Buffer, key: string) =>
    `https://s3.example.com/${key}`,
}));

afterAll(() => {
  mock.module("@almirant/config", () => realConfig);
  mock.module("@almirant/database", () => realDatabase);
  mock.module("./s3-service", () => realS3Service);
});

const originalFetch = globalThis.fetch;

describe("captureAndStoreScreenshot — Thum.io API key redaction", () => {
  beforeEach(() => {
    loggerCalls.info.length = 0;
    loggerCalls.error.length = 0;
    loggerCalls.warn.length = 0;
    dbUpdateCalls.length = 0;

    globalThis.fetch = mock(async () => {
      return new Response(new Uint8Array(2000), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("never logs the authenticated thum.io URL (which embeds the API key)", async () => {
    const { captureAndStoreScreenshot } = await import("./screenshot-service");

    const result = await captureAndStoreScreenshot(
      "project-1",
      "https://example-project.com",
    );

    expect(result).toMatch(
      /^https:\/\/s3\.example\.com\/screenshots\/projects\/project-1\/\d+\.png$/,
    );
    expect(dbUpdateCalls[0]?.screenshotUrl).toBe(result);

    // The success log must not embed the authenticated thum.io URL or the raw API key.
    const startLog = loggerCalls.info.find(
      ([, message]) => message === "Capturing screenshot via thum.io",
    );
    expect(startLog).toBeDefined();
    expect(startLog?.[0]).toEqual({ projectId: "project-1" });
    expect(Object.keys(startLog?.[0] ?? {})).not.toContain("thumUrl");

    // Belt-and-suspenders: no logged call (any level) should ever contain the
    // secret key value, regardless of which field name carries it.
    const allLoggedPayloads = [
      ...loggerCalls.info,
      ...loggerCalls.error,
      ...loggerCalls.warn,
    ].map(([fields]) => JSON.stringify(fields));

    for (const payload of allLoggedPayloads) {
      expect(payload).not.toContain(THUM_IO_API_KEY);
    }
  });

  test("does not leak the API key when thum.io returns a non-OK response", async () => {
    globalThis.fetch = mock(async () => new Response(null, { status: 502 })) as unknown as typeof fetch;

    const { captureAndStoreScreenshot } = await import("./screenshot-service");
    const result = await captureAndStoreScreenshot(
      "project-2",
      "https://example-project.com",
    );

    expect(result).toBeNull();

    const allLoggedPayloads = [
      ...loggerCalls.info,
      ...loggerCalls.error,
      ...loggerCalls.warn,
    ].map(([fields]) => JSON.stringify(fields));

    for (const payload of allLoggedPayloads) {
      expect(payload).not.toContain(THUM_IO_API_KEY);
    }
  });
});
