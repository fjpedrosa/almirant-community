import { describe, expect, it, spyOn } from "bun:test";
import crypto from "node:crypto";
import { inspect } from "node:util";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createControlAuth, type ControlAuthConfig } from "./control-auth.js";

const bootstrap = Buffer.alloc(32, 1).toString("base64url");
const active = Buffer.alloc(32, 2).toString("base64url");
const other = Buffer.alloc(32, 3).toString("base64url");
const bearer = (token: string) => `Bearer ${token}`;

describe("control auth", () => {
  it("stays dormant on import, without tracked callers or re-exports", async () => {
    const source = readFileSync(new URL("./control-auth.ts", import.meta.url), "utf8");
    expect([...source.matchAll(/^import .* from "([^"]+)"/gm)].map((match) => match[1]))
      .toEqual(["node:crypto"]);
    expect(source).not.toMatch(/\b(?:process|console|fetch|setTimeout|setInterval)\b/);
    const hash = spyOn(crypto, "createHash");
    const logs = (["log", "info", "warn", "error", "debug", "trace"] as const)
      .map((method) => spyOn(console, method).mockImplementation(() => {}));
    try {
      const authModule = await import(new URL("./control-auth.ts?dormancy", import.meta.url).href);
      expect(Object.keys(authModule)).toEqual(["createControlAuth"]);
      expect(hash).not.toHaveBeenCalled();
      for (const log of logs) expect(log).not.toHaveBeenCalled();
    } finally { hash.mockRestore(); for (const log of logs) log.mockRestore(); }
    for (const [pattern, paths] of [
      ["createControlAuth|shim-server.*control-auth", ["*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs"]],
      ["control-auth", ["services/runner/docker/shim-server/src"]],
    ] as const) {
      const callers = spawnSync("git", ["grep", "-n", "-E", pattern, "--", ...paths,
        ":!services/runner/docker/shim-server/src/control-auth.ts",
        ":!services/runner/docker/shim-server/src/control-auth.test.ts"],
      { cwd: new URL("../../../../../", import.meta.url), encoding: "utf8" });
      expect(callers.status).toBe(1); // git grep: no tracked matches.
      expect(callers.stdout).toBe("");
      expect(callers.stderr).toBe("");
    }
  });

  it("keeps disabled compatibility open without permitting activation", () => {
    const auth = createControlAuth({ mode: "disabled" });
    expect(auth.snapshot()).toEqual({ mode: "disabled" });
    expect(auth.authorize(undefined)).toEqual({ status: "authorized" });
    expect(auth.authorize("malformed")).toEqual({ status: "authorized" });
    expect(auth.activate(bearer(bootstrap), active)).toEqual({ status: "unavailable" });
    expect(auth.snapshot()).toEqual({ mode: "disabled" });
  });

  it("accepts only the static token and never activates", () => {
    const config = { mode: "static", token: active } as const;
    const auth = createControlAuth(config);
    expect(auth.snapshot()).toEqual({ mode: "static" });
    expect(auth.authorize(bearer(active))).toEqual({ status: "authorized" });
    expect(auth.authorize(bearer(other))).toEqual({ status: "unauthorized" });
    expect(auth.activate(bearer(active), other)).toEqual({ status: "unavailable" });
    expect(auth.authorize(bearer(other))).toEqual({ status: "unauthorized" });
  });

  it("accepts canonical zero bytes and URL-safe alphabet characters in every credential role", () => {
    for (const byte of [0, 248, 255]) {
      const token = Buffer.alloc(32, byte).toString("base64url");
      const fixed = createControlAuth({ mode: "static", token });
      expect(fixed.authorize(bearer(token))).toEqual({ status: "authorized" });
      const auth = createControlAuth({ mode: "bootstrap", token });
      expect(auth.activate(bearer(token), active)).toEqual({ status: "activated" });
      const next = createControlAuth({ mode: "bootstrap", token: bootstrap });
      expect(next.activate(bearer(bootstrap), token)).toEqual({ status: "activated" });
      expect(next.authorize(bearer(token))).toEqual({ status: "authorized" });
    }
  });

  it("commits once before returning, invalidating bootstrap and every replay", async () => {
    const auth = createControlAuth({ mode: "bootstrap", token: bootstrap });
    expect(auth.snapshot()).toEqual({ mode: "bootstrap" });
    for (const token of [bootstrap, active, other]) {
      expect(auth.authorize(bearer(token))).toEqual({ status: "unauthorized" });
    }
    const result = auth.activate(bearer(bootstrap), active);
    expect(result).toEqual({ status: "activated" });
    expect(result).not.toBeInstanceOf(Promise);
    expect(auth.snapshot()).toEqual({ mode: "active" });
    expect(auth.authorize(bearer(active))).toEqual({ status: "authorized" });
    for (const token of [bootstrap, active, other]) {
      expect(auth.activate(bearer(token), other)).toEqual({ status: "unavailable" });
    }
    expect(auth.authorize(bearer(bootstrap))).toEqual({ status: "unauthorized" });
    expect(auth.authorize(bearer(other))).toEqual({ status: "unauthorized" });
    const race = createControlAuth({ mode: "bootstrap", token: bootstrap });
    const attempts = await Promise.all([active, other].map((token) =>
      Promise.resolve().then(() => race.activate(bearer(bootstrap), token))));
    expect(attempts).toEqual([{ status: "activated" }, { status: "unavailable" }]);
    expect(race.authorize(bearer(active))).toEqual({ status: "authorized" });
    expect(race.authorize(bearer(other))).toEqual({ status: "unauthorized" });
  });

  const invalidTokens: unknown[] = [undefined, null, 123, {}, [], new String(active),
    { toString() { throw new Error(active); } },
    "", "a".repeat(42), "a".repeat(44), "a".repeat(1_000_000), `${active}=`,
    ` ${active}`, `${active}\n`, "+".repeat(43), "/".repeat(43), "é".repeat(43),
    `${active.slice(0, -1)}J`]; // Nonzero unused base64 bits: alias of active.

  it("rejects malformed configurations with a single secret-safe error", () => {
    const configs: unknown[] = [undefined, null, true, [], {}, { mode: "active", token: active },
      { mode: "disabled", token: active }, { mode: "static" }, { mode: "bootstrap" },
      { get mode() { throw new Error(active); } },
      { mode: "static", get token() { throw new Error(active); } }];
    for (const mode of ["static", "bootstrap"]) {
      configs.push(...invalidTokens.map((token) => ({ mode, token })));
    }
    for (const config of configs) {
      let caught: unknown;
      try { createControlAuth(config as ControlAuthConfig); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe("Invalid control authentication configuration");
      expect(inspect(caught)).not.toContain(active);
      expect(JSON.stringify(caught)).not.toContain(active);
    }
  });

  it("rejects malformed headers and proposals without consuming bootstrap", () => {
    const invalidHeaders: unknown[] = [undefined, null, {}, [bearer(active)], 123,
      new String(bearer(active)), "", active, `bearer ${active}`, `BEARER ${active}`,
      `Bearer  ${active}`, `Bearer\t${active}`, ` Bearer ${active}`, `${bearer(active)} `,
      `${bearer(active)}\r\n`, `${bearer(active)},${bearer(active)}`,
      `Bearer ${"a".repeat(1_000_000)}`, ...invalidTokens.filter((token) => typeof token === "string").map((token) => `Bearer ${token}`)];
    const fixed = createControlAuth({ mode: "static", token: active });
    const auth = createControlAuth({ mode: "bootstrap", token: bootstrap });
    for (const header of invalidHeaders) {
      expect(fixed.authorize(header)).toEqual({ status: "unauthorized" });
      expect(auth.activate(header, active)).toEqual({ status: "unauthorized" });
    }
    for (const token of [...invalidTokens, bootstrap]) {
      expect(auth.activate(bearer(bootstrap), token)).toEqual({ status: "unauthorized" });
    }
    expect(auth.activate(bearer(other), active)).toEqual({ status: "unauthorized" });
    expect(auth.snapshot()).toEqual({ mode: "bootstrap" });
    expect(auth.activate(bearer(bootstrap), active)).toEqual({ status: "activated" });
    for (const header of invalidHeaders) {
      expect(auth.authorize(header)).toEqual({ status: "unauthorized" });
    }
  });

  it("bounds decoding/hashing, compares 32-byte digests, and wipes owned buffers", () => {
    const decode = spyOn(Buffer, "from");
    const update = spyOn(crypto.Hash.prototype, "update");
    const digest = spyOn(crypto.Hash.prototype, "digest");
    const compare = spyOn(crypto, "timingSafeEqual");
    try {
      const auth = createControlAuth({ mode: "bootstrap", token: bootstrap });
      const before = decode.mock.calls.length;
      expect(auth.activate(bearer(bootstrap), "a".repeat(1_000_000))).toEqual({ status: "unauthorized" });
      expect(() => createControlAuth({ mode: "static", token: "a".repeat(1_000_000) })).toThrow();
      expect(decode.mock.calls.length).toBe(before);
      expect(update).not.toHaveBeenCalled();
      expect(() => createControlAuth({ mode: "static", token: `${active.slice(0, -1)}J` })).toThrow();
      expect(auth.activate(bearer(bootstrap), active)).toEqual({ status: "activated" });
      const decodedCount = decode.mock.calls.length;
      expect(auth.authorize(`Bearer ${"a".repeat(1_000_000)}`)).toEqual({ status: "unauthorized" });
      expect(decode.mock.calls.length).toBe(decodedCount);
      expect(auth.authorize(bearer(active))).toEqual({ status: "authorized" });
      expect(auth.authorize(bearer(other))).toEqual({ status: "unauthorized" });
      compare.mockImplementationOnce(() => { throw new Error(active); });
      expect(auth.authorize(bearer(active))).toEqual({ status: "unauthorized" });
      expect(compare).toHaveBeenCalledTimes(5);
      for (const [left, right] of compare.mock.calls) {
        expect(left.byteLength).toBe(32);
        expect(right.byteLength).toBe(32);
      }
      expect(update.mock.calls).toHaveLength(10);
      const updateCalls = update.mock.calls as unknown as [Buffer][];
      for (const [input] of updateCalls) {
        expect(Buffer.isBuffer(input)).toBe(true);
        expect(input.length).toBe(32);
      }
      const decodeCalls = decode.mock.calls as unknown as [string, BufferEncoding][];
      for (const [input, encoding] of decodeCalls) {
        expect(typeof input).toBe("string");
        expect(input.length).toBe(43);
        expect(encoding).toBe("base64url");
      }
      for (const spy of [decode, digest]) {
        for (const result of spy.mock.results) {
          expect(result.type).toBe("return");
          expect((result.value as Buffer).every((byte) => byte === 0)).toBe(true);
        }
      }
    } finally {
      decode.mockRestore(); update.mockRestore(); digest.mockRestore(); compare.mockRestore();
    }
  });

  it("wipes partial hashing work on failure and leaves bootstrap retryable", () => {
    const auth = createControlAuth({ mode: "bootstrap", token: bootstrap });
    const decode = spyOn(Buffer, "from");
    const digest = spyOn(crypto.Hash.prototype, "digest");
    const realCreateHash = crypto.createHash;
    const hash = spyOn(crypto, "createHash")
      .mockImplementationOnce(realCreateHash)
      .mockImplementationOnce(() => { throw new Error(bootstrap); });
    try {
      expect(auth.activate(bearer(bootstrap), active)).toEqual({ status: "unauthorized" });
      expect(auth.snapshot()).toEqual({ mode: "bootstrap" });
      expect(digest.mock.results).toHaveLength(1);
      for (const spy of [decode, digest]) {
        for (const result of spy.mock.results) {
          expect((result.value as Buffer).every((byte) => byte === 0)).toBe(true);
        }
      }
    } finally { decode.mockRestore(); digest.mockRestore(); hash.mockRestore(); }
    expect(auth.activate(bearer(bootstrap), active)).toEqual({ status: "activated" });
  });

  it("does not expose credentials or allow external state mutation, and never logs", () => {
    const spies = (["log", "info", "warn", "error", "debug", "trace"] as const)
      .map((method) => spyOn(console, method).mockImplementation(() => {}));
    try {
      for (const mode of ["disabled", "static", "bootstrap"] as const) {
        const config: ControlAuthConfig = mode === "disabled" ? { mode } : { mode, token: bootstrap };
        const auth = createControlAuth(config);
        if ("token" in config) config.token = other;
        const before = auth.snapshot();
        expect(Reflect.set(before, "mode", "disabled")).toBe(false);
        if (mode === "static") {
          expect(auth.authorize(bearer(bootstrap))).toEqual({ status: "authorized" });
          expect(auth.authorize(bearer(other))).toEqual({ status: "unauthorized" });
        }
        const result = auth.activate(bearer(bootstrap), active);
        const values = [auth, before, auth.snapshot(), result, auth.authorize(bearer(active)),
          Object.getOwnPropertyDescriptors(auth)];
        for (const value of values) {
          for (const token of [bootstrap, active, other]) {
            expect(JSON.stringify(value)).not.toContain(token);
            expect(inspect(value, { showHidden: true })).not.toContain(token);
          }
        }
        expect(Object.isFrozen(auth)).toBe(true);
        if (mode === "bootstrap") {
          expect(result).toEqual({ status: "activated" });
          expect(before).toEqual({ mode: "bootstrap" });
          expect(auth.snapshot()).toEqual({ mode: "active" });
        }
      }
      expect(() => createControlAuth({ mode: "static", token: active + "=" })).toThrow();
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally { for (const spy of spies) spy.mockRestore(); }
  });
});
