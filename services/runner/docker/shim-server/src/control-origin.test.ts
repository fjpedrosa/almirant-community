import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isExternalControlOrigin } from "./control-origin.js";

const inventory = (...addresses: string[]) => () => ({
  eth0: addresses.map((address) => ({ address })),
});
const local = inventory("127.0.0.1", "::1", "172.18.0.2", "fd00::2");

describe("direct control peer origin", () => {
  it("accepts external Docker/private peers without destination policy", () => {
    for (const peer of ["172.18.0.1", "10.0.0.1", "192.168.1.1", "fd00::1", "2001:db8::1"]) {
      expect(isExternalControlOrigin(peer, local)).toBe(true);
    }
  });

  it("rejects unspecified, loopback, and exact local peers", () => {
    for (const peer of ["0.0.0.0", "::", "127.0.0.0", "127.255.255.255", "::1", "172.18.0.2", "fd00::2"]) {
      expect(isExternalControlOrigin(peer, local)).toBe(false);
    }
  });

  it("accepts canonical IPv4 boundaries outside 127/8", () => {
    for (const peer of ["0.0.0.1", "1.0.0.0", "126.255.255.255", "128.0.0.0", "255.255.255.255"]) {
      expect(isExternalControlOrigin(peer, local)).toBe(true);
    }
    for (let octet = 0; octet <= 255; octet++) {
      expect(isExternalControlOrigin(`127.${octet}.0.255`, local)).toBe(false);
    }
  });

  it("compares compressed, expanded, and uppercase IPv6 by address bytes", () => {
    for (const peer of ["2001:DB8::ABCD", "2001:0db8:0000:0:0:0:0:abcd"]) {
      expect(isExternalControlOrigin(peer, inventory("2001:db8::abcd"))).toBe(false);
      expect(isExternalControlOrigin("2001:db8::abcd", inventory(peer))).toBe(false);
      expect(isExternalControlOrigin(peer, local)).toBe(true);
    }
    expect(isExternalControlOrigin("1:2:3:4:5:6:7::", local)).toBe(true);
    expect(isExternalControlOrigin("::1:2:3:4:5:6:7", local)).toBe(true);
    expect(isExternalControlOrigin("0:0:0:0:0:0:0:0", local)).toBe(false);
    expect(isExternalControlOrigin("0000:0:0:0:0:0:0:0001", local)).toBe(false);
  });

  it("validates IPv6 zones then ignores them for conservative equality", () => {
    for (const zone of ["eth0", "en0.1", "veth_a-b", "12", "a".repeat(64)]) {
      const peer = `fe80::abcd%${zone}`;
      expect(isExternalControlOrigin(peer, local)).toBe(true);
      expect(isExternalControlOrigin(peer, inventory("fe80:0:0:0:0:0:0:ABCD%other"))).toBe(false);
      expect(isExternalControlOrigin("fe80::abcd", inventory(peer))).toBe(false);
    }
    expect(isExternalControlOrigin("::%eth0", local)).toBe(false);
    expect(isExternalControlOrigin("::1%12", local)).toBe(false);
    // Longest textual IPv6 form plus the bounded zone: exactly 110 characters.
    expect(isExternalControlOrigin(`1111:2222:3333:4444:5555:6666:192.168.100.100%${"a".repeat(64)}`, local)).toBe(true);
  });

  it("unifies dotted and hexadecimal mapped IPv4 in both comparison directions", () => {
    for (const peer of ["::ffff:172.18.0.2", "::FFFF:ac12:2", "0:0:0:0:0:ffff:ac12:0002"]) {
      expect(isExternalControlOrigin(peer, local)).toBe(false);
      expect(isExternalControlOrigin("172.18.0.2", inventory(peer))).toBe(false);
    }
    for (const peer of ["::ffff:172.18.0.1", "::FFFF:ac12:1", "::ffff:ac12:1%eth0"]) {
      expect(isExternalControlOrigin(peer, local)).toBe(true);
    }
    for (const peer of ["::ffff:0.0.0.0", "::ffff:0:0", "::ffff:127.0.0.1", "::ffff:7fff:ffff",
      "0:0:0:0:0:ffff:7f00:1%eth0"]) {
      expect(isExternalControlOrigin(peer, local)).toBe(false);
    }
    // IPv4-compatible IPv6 is not the IPv4-mapped prefix.
    expect(isExternalControlOrigin("::ac12:2", local)).toBe(true);
    expect(isExternalControlOrigin("2001:db8::192.0.2.1", inventory("2001:db8::c000:201"))).toBe(false);
  });

  const malformed: unknown[] = [undefined, null, 123, {}, [], new String("172.18.0.1"),
    { toString() { throw new Error("must not coerce"); } }, "", "a".repeat(1_000_000),
    "localhost", "docker.internal", "172.18.0.1:80", "[fd00::1]:80", "[fd00::1]", "http://172.18.0.1/",
    "for=172.18.0.1", "172.18.0.1, 10.0.0.1", " 172.18.0.1", "172.18.0.1\n", "172.18.0.1\0",
    "01.2.3.4", "1.02.3.4", "1.2.03.4", "1.2.3.04", "256.0.0.1", "1.2.3.-1", "1.2.3.4.5",
    "1.2.3", "127.1", "2130706433", "0x7f000001", "1e2.0.0.1", "+1.2.3.4", "１.2.3.4",
    ":::", "1::2::3", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7:8::",
    "12345::1", "gggg::1", "fd00::1/64", "fd00::1\n", "::ffff:0172.18.0.1", "::ffff:256.0.0.1",
    "172.18.0.1%eth0", "fd00::1%", "fd00::1%%eth0", "fd00::1%a%b", "fd00::1%eth 0",
    "fd00::1%eth0\n", "fd00::1%eth0/1", "fd00::1%é", "fd00::1%eth0:80", `fd00::1%${"a".repeat(65)}`];

  it("rejects malformed, ambiguous, non-IP, and unbounded peers without discovery", () => {
    let calls = 0;
    for (const peer of malformed) {
      expect(isExternalControlOrigin(peer, () => { calls++; return local(); })).toBe(false);
    }
    expect(calls).toBe(0);
  });

  it("rejects every malformed local address even after an otherwise valid inventory", () => {
    for (const address of malformed) {
      expect(isExternalControlOrigin("172.18.0.1", () => ({
        ...local(), bad: [{ address: address as string }],
      }))).toBe(false);
    }
    for (const value of [null, undefined, [], "bad", { eth0: null }, { eth0: [null] },
      { eth0: [{}] }, { eth0: new Array(1) }, { eth0: "172.18.0.2" },
      { get eth0() { throw new Error("private address"); } },
      { eth0: [{ get address() { throw new Error("private address"); } }] }]) {
      expect(isExternalControlOrigin("172.18.0.1", () => value as ReturnType<typeof local>)).toBe(false);
    }
  });

  for (const hidden of ["172.18.0.1", "malformed"]) {
    it(`does not let a custom iterator hide ${hidden === "malformed" ? "malformed entries" : "the local peer"}`, () => {
      const entries = [{ address: "172.18.0.2" }, { address: hidden }];
      let calls = 0;
      entries[Symbol.iterator] = () => { calls++; return [entries[0]!][Symbol.iterator](); };
      expect(isExternalControlOrigin("172.18.0.1", () => ({ eth0: entries }))).toBe(false);
      expect(calls).toBe(0);
    });
  }

  const decideInventory = (value: unknown) =>
    isExternalControlOrigin("172.18.0.1", () => value as ReturnType<typeof local>);
  const safeEntry = { address: "172.18.0.2" };

  it("rejects holes, inherited slots, and non-object entries", () => {
    const inherited = new Array(1);
    Object.setPrototypeOf(inherited, { 0: safeEntry });
    for (const entries of [new Array(1), [safeEntry, , safeEntry], inherited,
      [null], [undefined], ["172.18.0.2"], [123], [() => safeEntry], [[safeEntry]],
      [Object.create(safeEntry)]]) {
      expect(decideInventory({ eth0: entries })).toBe(false);
    }
  });

  it("rejects accessors without invoking them at every inventory layer", () => {
    let calls = 0;
    const getter = () => { calls++; return safeEntry; };
    const entry = Object.defineProperty({}, "address", { get: getter });
    const entries = Object.defineProperty([safeEntry], "0", { get: getter });
    for (const value of [Object.defineProperty({}, "eth0", { get: getter }),
      { eth0: entries }, { eth0: [entry] },
      Object.defineProperty({ eth0: [safeEntry] }, "hidden", { get: getter })]) {
      expect(decideInventory(value)).toBe(false);
    }
    expect(calls).toBe(0);
    const noIterator = Object.defineProperty([safeEntry], Symbol.iterator, { get: getter });
    expect(decideInventory({ eth0: noIterator })).toBe(true);
    expect(calls).toBe(0);
  });

  it("checks non-enumerable data and accepts null-prototype/frozen Node-shaped records", () => {
    const hidden = Object.defineProperty({ eth0: [safeEntry] }, "hidden", {
      value: [{ address: "172.18.0.1" }], enumerable: false,
    });
    expect(decideInventory(hidden)).toBe(false);
    const address = Object.defineProperty({}, "address", { value: "172.18.0.2" });
    const record = Object.create(null);
    record.eth0 = Object.freeze([Object.freeze({ ...safeEntry, family: "IPv4", internal: false,
      netmask: "255.255.0.0", mac: "00:00:00:00:00:00", cidr: "172.18.0.2/16" })]);
    expect(decideInventory(Object.freeze(record))).toBe(true);
    expect(decideInventory({ eth0: [address] })).toBe(true);
    expect(decideInventory(Object.create({ eth0: [safeEntry] }))).toBe(false);
  });

  it("bounds own interface count/name length and total entries before reading slots", () => {
    const names = (count: number) => Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`eth${index}`, [safeEntry]]));
    expect(decideInventory(names(256))).toBe(true);
    expect(decideInventory(names(257))).toBe(false);
    expect(decideInventory({ ["n".repeat(256)]: [safeEntry] })).toBe(true);
    expect(decideInventory({ ["n".repeat(257)]: [safeEntry] })).toBe(false);
    expect(decideInventory({ "": [safeEntry] })).toBe(false);
    expect(decideInventory({ eth0: [safeEntry], [Symbol("hidden")]: [safeEntry] })).toBe(false);
    expect(decideInventory({ eth0: Array(4096).fill(safeEntry) })).toBe(true);
    expect(decideInventory({ eth0: Array(2048).fill(safeEntry), eth1: Array(2048).fill(safeEntry) })).toBe(true);
    expect(decideInventory({ eth0: Array(2048).fill(safeEntry), eth1: Array(2049).fill(safeEntry) })).toBe(false);
    let reads = 0;
    for (const length of [4097, 0xffffffff]) {
      const oversized = new Proxy(new Array(length), {
        getOwnPropertyDescriptor(target, key) {
          if (key !== "length") reads++;
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      expect(decideInventory({ eth0: oversized })).toBe(false);
    }
    expect(reads).toBe(0);
  });

  it("fails closed on descriptor/own-key traps and inconsistent descriptors", () => {
    const fail = () => { throw new Error("private inventory details"); };
    for (const value of [new Proxy({}, { ownKeys: fail }),
      new Proxy({ eth0: [safeEntry] }, { getOwnPropertyDescriptor: fail }),
      new Proxy({ eth0: [safeEntry] }, { getOwnPropertyDescriptor: () => undefined }),
      { eth0: new Proxy([safeEntry], { getOwnPropertyDescriptor: fail }) },
      { eth0: [new Proxy(safeEntry, { getOwnPropertyDescriptor: fail })] },
      { eth0: [new Proxy(safeEntry, { getOwnPropertyDescriptor: () => ({ get: () => "172.18.0.2", configurable: true }) })] }]) {
      expect(decideInventory(value)).toBe(false);
    }
    for (const length of [-1, 1.5, NaN, Infinity, "1", undefined]) {
      const entries = new Proxy([safeEntry], {
        getOwnPropertyDescriptor(target, key) {
          return key === "length" ? { value: length, writable: true, configurable: false }
            : Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
      expect(decideInventory({ eth0: entries })).toBe(false);
    }
    const invalidDescriptor = new Proxy(safeEntry, {
      getOwnPropertyDescriptor: () => ({ value: "172.18.0.2", get: () => "172.18.0.2" }),
    });
    expect(decideInventory({ eth0: [invalidDescriptor] })).toBe(false);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(decideInventory(revoked.proxy)).toBe(false);
  });

  it("discovers once per valid decision, observes changes, and never mutates inventory", () => {
    const entries = Object.freeze([Object.freeze({ address: "172.18.0.2" })]);
    const snapshot = Object.freeze({ eth0: entries, absent: undefined, empty: [] });
    let calls = 0;
    const discover = () => { calls++; return calls === 1 ? snapshot : local(); };
    expect(isExternalControlOrigin("fd00::2", discover)).toBe(true);
    expect(isExternalControlOrigin("fd00::2", discover)).toBe(false);
    expect(calls).toBe(2);
    expect(snapshot.eth0).toEqual([{ address: "172.18.0.2" }]);
    expect(isExternalControlOrigin("172.18.0.1", () => ({ absent: undefined }))).toBe(false);
  });

  it("stays dormant on import, discovers lazily by default, and never logs", () => {
    const url = new URL("./control-origin.ts", import.meta.url);
    const source = readFileSync(url, "utf8");
    expect([...source.matchAll(/^import .* from "([^"]+)"/gm)].map((match) => match[1]))
      .toEqual(["node:net", "node:os"]);
    expect(source).not.toMatch(/\b(?:console|process|fetch|setTimeout|setInterval)\b/);
    // Isolated module mock: no global/module mutation in the test runner process.
    const script = `
      import { spyOn } from "bun:test";
      import os from "node:os";
      let calls = 0;
      spyOn(os, "networkInterfaces").mockImplementation(() => {
        calls++; return { eth0: [{ address: "172.18.0.2" }] };
      });
      const module = await import(${JSON.stringify(url.href)});
      await import(${JSON.stringify(new URL("./server.ts", import.meta.url).href)});
      if (calls !== 0 || Object.keys(module).join() !== "isExternalControlOrigin") process.exit(1);
      const decide = module.isExternalControlOrigin;
      if (!decide("172.18.0.1", () => ({ eth0: [{ address: "172.18.0.2" }] })) || calls !== 0) process.exit(2);
      if (!decide("172.18.0.1") || calls !== 1) process.exit(3);
      if (decide("172.18.0.2") || calls !== 2) process.exit(4);
      if (decide("bad") || calls !== 2) process.exit(5);
      if (decide("172.18.0.1", () => { throw new Error("private address"); })) process.exit(6);
    `;
    const result = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", script], {
      env: {}, stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toBe("");
  });

  it("has only the dormant shim-server production caller and no re-export", () => {
    const result = Bun.spawnSync(["git", "grep", "-l", "-E", "control-origin|isExternalControlOrigin", "--",
      "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs", ":!**/control-origin.ts", ":!**/control-origin.test.ts"], {
      cwd: fileURLToPath(new URL("../../../../../", import.meta.url)), stdout: "pipe", stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("services/runner/docker/shim-server/src/server.ts\n");
    expect(result.stderr.toString()).toBe("");
  });

  it("fails closed on empty, malformed, or throwing discovery", () => {
    for (const discover of [inventory(), () => ({}), inventory("172.18.0.2", "broken"),
      () => { throw new Error("private discovery details"); }]) {
      expect(isExternalControlOrigin("172.18.0.1", discover)).toBe(false);
    }
  });
});
