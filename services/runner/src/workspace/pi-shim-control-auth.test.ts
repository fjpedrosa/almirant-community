import { describe, expect, it, spyOn } from "bun:test";
import {
  activatePiShimControlAuth as activate,
  PiShimControlAuthActivationError,
  type ActivatePiShimControlAuthInput,
} from "./pi-shim-control-auth";

const bootstrapToken = Buffer.alloc(32, 21).toString("base64url");
const activeToken = Buffer.alloc(32, 22).toString("base64url");
const hostile = `hostile upstream ${bootstrapToken} ${activeToken}`;
const defaults = { baseUrl: "https://pi-shim.test:4096", bootstrapToken, activeToken };
const response = (status: number) => new Response(null, { status });
const setup = (outcomes: Array<number | undefined> = [204]) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const controller = new AbortController();
  const input: ActivatePiShimControlAuthInput = {
    ...defaults, signal: controller.signal,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      const status = outcomes[calls.length - 1];
      if (status === undefined) throw new Error(hostile);
      return response(status);
    },
  };
  return { calls, controller, input };
};
const failure = async (input: ActivatePiShimControlAuthInput, reason: string) => {
  const error = await activate(input).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(PiShimControlAuthActivationError);
  expect(error).toMatchObject({ code: "PI_SHIM_CONTROL_AUTH_ACTIVATION_FAILED", reason });
  expect(String(error)).toBe(`PiShimControlAuthActivationError: Pi shim control authentication failed: ${reason}`);
  expect(error).not.toHaveProperty("cause");
  expect(JSON.stringify(error)).not.toMatch(new RegExp(`${bootstrapToken}|${activeToken}|hostile`));
};

describe("dormant Pi control authentication", () => {
  it("sends exactly the activation URL, headers, no body, and stops on 204", async () => {
    const { input, calls } = setup();
    await activate(input);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      url: `${defaults.baseUrl}/control/activate`,
      init: {
        method: "POST", redirect: "manual",
        headers: { Authorization: `Bearer ${bootstrapToken}`, "X-Almirant-Active-Token": activeToken },
        signal: expect.any(AbortSignal),
      },
    });
  });

  for (const status of [undefined, 200, 201, 202, 301, 302, 303, 307, 308, 401, 409, 500]) {
    it(`proves ambiguous activation (${status ?? "transport"}) with one active-only GET`, async () => {
      const { input, calls } = setup([status, 200]);
      await activate(input);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.init.method).toBe("POST");
      expect(calls[1]).toEqual({ url: `${defaults.baseUrl}/session`, init: {
        method: "GET", redirect: "manual",
        headers: { Authorization: `Bearer ${activeToken}` }, signal: expect.any(AbortSignal),
      } });
      expect(calls.some(({ url, init }) => url.endsWith("/session") && init.method === "POST")).toBe(false);
    });
  }

  for (const status of [undefined, 201, 204, 301, 302, 303, 307, 308, 401, 500]) {
    it(`fails closed on unproven GET (${status ?? "transport"}) without upstream details`, async () => {
      const { input, calls } = setup([500, status]);
      await failure(input, "activation_unproven");
      expect(calls).toHaveLength(2);
    });
  }

  it("rejects malformed and equal tokens before transport", async () => {
    const { input, calls } = setup();
    const malformed = ["", "invalid", `${activeToken}=`, ` ${activeToken}`, `${activeToken}\n`,
      "+".repeat(43), "A".repeat(42) + "B", Buffer.alloc(31).toString("base64url"),
      Buffer.alloc(33).toString("base64url"), null, 123];
    for (const token of malformed) {
      for (const field of ["bootstrapToken", "activeToken"]) {
        await failure({ ...input, [field]: token }, "invalid_input");
      }
    }
    await failure({ ...input, activeToken: bootstrapToken }, "invalid_input");
    expect(calls).toHaveLength(0);
  });

  it("rejects unsafe or parser-normalized non-origin URLs", async () => {
    const { input, calls } = setup();
    for (const baseUrl of ["file:///socket", "ftp://host", "//host", "http:host", "http:///host",
      "http://pi-shim.test", "http://172.17.0.2", "http://10.0.0.1", "http://192.168.1.1", "http://8.8.8.8",
      "http://localhost.evil", "http://evil.localhost", "http://localhost.", "http://127.0.0.1.evil", "http://[::2]",
      "http://[fd00::1]", "http://[::ffff:127.0.0.1]", "http://126.255.255.255", "http://128.0.0.0",
      "http://u@localhost", "http://localhost/path", "http://localhost?", "http://localhost#",
      "https://u:p@host", "https://@host", "https://host/path", "https://host/..", "https://host/%2e",
      "https://host?", "https://host#", `https://host?q=${activeToken}`, "https://host/#fragment",
      " https://host", "https://host\n", "https://host\r", "https://ho\nst", "https://host\\", "https://", "https://host:99999"]) {
      await failure({ ...input, baseUrl }, "invalid_input");
    }
    expect(calls).toHaveLength(0);
  });

  it("accepts root HTTP(S) origins including IPv6 and derives exact paths", async () => {
    for (const baseUrl of ["https://pi-shim.test/", "http://[::1]:4096/", "http://localhost:4096/",
      "http://127.0.0.1", "http://127.0.0.0", "http://127.255.255.255"]) {
      const { input, calls } = setup([500, 200]);
      await activate({ ...input, baseUrl });
      expect(calls.map(({ url }) => url)).toEqual([
        new URL("/control/activate", baseUrl).href, new URL("/session", baseUrl).href,
      ]);
    }
  });

  it("rejects invalid timeout values, including platform overflow", async () => {
    const { input, calls } = setup();
    for (const timeoutMs of [0, 1, -1, 2.5, NaN, Infinity, 2 ** 31, Number.MAX_SAFE_INTEGER, null, "10"]) {
      await failure({ ...input, timeoutMs: timeoutMs as number }, "invalid_input");
    }
    expect(calls).toHaveLength(0);
    for (const timeoutMs of [2, 2 ** 31 - 1]) await activate({ ...setup().input, timeoutMs });
  });

  it("honors pre-abort without transport or exposing the caller reason", async () => {
    const { input, controller, calls } = setup();
    controller.abort(new Error(hostile));
    await failure(input, "aborted");
    expect(calls).toHaveLength(0);
  });

  for (const phase of [1, 2]) {
    for (const settles of [false, true]) {
      it(`honors abort in request ${phase} even if transport ${settles ? "resolves proof" : "ignores signal"}`, async () => {
        const { input, controller } = setup();
        let calls = 0;
        await failure({ ...input, fetchImpl: () => {
          calls++;
          if (calls < phase) return Promise.resolve(response(500));
          queueMicrotask(() => controller.abort(new Error(hostile)));
          if (settles) return Promise.resolve(response(phase === 1 ? 204 : 200));
          return new Promise(() => {});
        } }, "aborted");
        expect(calls).toBe(phase);
      });
    }
  }

  it("bounds both ignored-signal requests and safely absorbs late rejections", async () => {
    const { input } = setup();
    const rejects: Array<(reason: Error) => void> = [];
    const signals: AbortSignal[] = [];
    const started = performance.now();
    await failure({ ...input, timeoutMs: 20, fetchImpl: (_url, init) => {
      signals.push(init!.signal!);
      return new Promise((_resolve, reject) => rejects.push(reject));
    } }, "activation_unproven");
    expect(performance.now() - started).toBeLessThan(500);
    expect(rejects).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    for (const reject of rejects) reject(new Error(hostile));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }, 1_000);

  for (const mode of ["resolve", "reject", "hang", "throw", "getter", "thenable"]) {
    it(`cancels unused bodies without trusting cleanup (${mode})`, async () => {
      for (const statuses of [[204], [500, 200], [500, 401], [-1, 200]]) {
        const canceled: number[] = [];
        let calls = 0;
        const input = { ...setup().input, fetchImpl: async () => {
          const status = statuses[calls++]!;
          return { get status() { if (status === -1) throw new Error(hostile); return status; },
            get body() {
              if (mode === "getter") throw new Error(hostile);
              return { cancel() {
                canceled.push(status);
                if (mode === "throw") throw new Error(hostile);
                if (mode === "reject") return Promise.reject(new Error(hostile));
                if (mode === "thenable") return { get then() { throw new Error(hostile); } };
                return mode === "hang" ? new Promise(() => {}) : Promise.resolve();
              } };
            },
          } as unknown as Response;
        } };
        if (statuses.at(-1) === 401) await failure(input, "activation_unproven");
        else await activate(input);
        expect(calls).toBe(statuses.length);
        expect(canceled).toEqual(mode === "getter" ? [] : statuses);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }, 1_000);
  }

  it("cancels both late timeout responses and absorbs cleanup rejection", async () => {
    const finishes: Array<(value: Response) => void> = [];
    let canceled = 0;
    await failure({ ...setup().input, timeoutMs: 20, fetchImpl: () =>
      new Promise((resolve) => finishes.push(resolve)) }, "activation_unproven");
    expect(finishes).toHaveLength(2);
    for (const finish of finishes) finish({ status: 200, body: { cancel() {
      canceled++; return Promise.reject(new Error(hostile));
    } } } as unknown as Response);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(canceled).toBe(2);
  }, 1_000);

  it("can recover after activation times out without trusting its late response", async () => {
    const { input } = setup();
    let calls = 0;
    let finish!: (value: Response) => void;
    await activate({ ...input, timeoutMs: 20, fetchImpl: () => {
      if (++calls === 1) return new Promise((resolve) => { finish = resolve; });
      return Promise.resolve(response(200));
    } });
    finish(response(204));
    expect(calls).toBe(2);
  }, 1_000);

  it("sanitizes synchronous transport throws and hostile status getters", async () => {
    const { input } = setup();
    for (const fetchImpl of [
      () => { throw new Error(hostile); },
      async () => ({ get status() { throw new Error(hostile); } }) as unknown as Response,
    ]) {
      let calls = 0;
      await failure({ ...input, fetchImpl: () => { calls++; return fetchImpl(); } }, "activation_unproven");
      expect(calls).toBe(2);
    }
  });

  it("zeroes owned decoded buffers on canonical, noncanonical, and equal token paths", async () => {
    const { input } = setup();
    const buffers: Buffer[] = [];
    const original = Buffer.from;
    const spy = spyOn(Buffer, "from").mockImplementation(((...args: unknown[]) => {
      const decoded = Reflect.apply(original, Buffer, args) as Buffer;
      if (args[1] === "base64url") buffers.push(decoded);
      return decoded;
    }) as typeof Buffer.from);
    try {
      await activate(input);
      await failure({ ...input, activeToken: "A".repeat(42) + "B" }, "invalid_input");
      await failure({ ...input, activeToken: bootstrapToken }, "invalid_input");
      expect(buffers.length).toBeGreaterThanOrEqual(5);
      expect(buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
      const encodeSpy = spyOn(Buffer.prototype, "toString").mockImplementation(() => { throw new Error(hostile); });
      try {
        await failure(input, "invalid_input");
        expect(buffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
      } finally {
        encodeSpy.mockRestore();
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("does not dispatch after an abort queued before transport starts", async () => {
    const { input, controller, calls } = setup();
    queueMicrotask(() => controller.abort(new Error(hostile)));
    await failure(input, "aborted");
    expect(calls).toHaveLength(0);
  });

  it("never logs activation success, transport failures, or invalid inputs", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const)
      .map((method) => spyOn(console, method).mockImplementation(() => {}));
    try {
      await activate(setup().input);
      await failure(setup([]).input, "activation_unproven");
      await failure({ ...setup().input, activeToken: hostile }, "invalid_input");
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
