import { describe, expect, it } from "bun:test";
import {
  getDefaultLocalFrontendOrigins,
  resolveBrowserApiBaseUrl,
  resolveBrowserWsBaseUrl,
  resolveOrbStackServiceOrigin,
} from "./runtime-service-url";

describe("runtime-service-url", () => {
  it("includes OrbStack and localhost trusted origins outside production", () => {
    expect(getDefaultLocalFrontendOrigins({ NODE_ENV: "development" })).toEqual(
      ["http://localhost:3000", "https://frontend.almirant.orb.local"]
    );
  });

  it("does not inject local trusted origins in production", () => {
    expect(getDefaultLocalFrontendOrigins({ NODE_ENV: "production" })).toEqual(
      []
    );
  });

  it("derives backend sibling origin from OrbStack frontend host", () => {
    expect(
      resolveOrbStackServiceOrigin("backend", {
        protocol: "https:",
        host: "frontend.almirant.orb.local",
      })
    ).toBe("https://backend.almirant.orb.local");
  });

  it("returns null when the host is not an OrbStack frontend host", () => {
    expect(
      resolveOrbStackServiceOrigin("backend", {
        protocol: "http:",
        host: "localhost:3000",
      })
    ).toBeNull();
  });

  it("prefers the OrbStack backend URL for browser API calls", () => {
    expect(
      resolveBrowserApiBaseUrl("http://localhost:3001/api", {
        protocol: "https:",
        host: "frontend.almirant.orb.local",
      })
    ).toBe("https://backend.almirant.orb.local/api");
  });

  it("falls back to the configured API URL outside OrbStack", () => {
    expect(
      resolveBrowserApiBaseUrl("http://localhost:3001/api", {
        protocol: "http:",
        host: "localhost:3000",
      })
    ).toBe("http://localhost:3001/api");
  });

  it("uses same-origin /api when a tailnet browser receives a loopback API URL", () => {
    expect(
      resolveBrowserApiBaseUrl("http://localhost:8081/api", {
        protocol: "https:",
        host: "macbook-m1-pro.tail6de2a1.ts.net",
      })
    ).toBe("/api");
  });

  it("normalizes duplicated /api suffixes in configured browser API URLs", () => {
    expect(
      resolveBrowserApiBaseUrl("https://example.com/api/api/", {
        protocol: "https:",
        host: "example.com",
      })
    ).toBe("https://example.com/api");
  });

  it("normalizes relative duplicated /api suffixes in configured browser API URLs", () => {
    expect(
      resolveBrowserApiBaseUrl("/api/api/", {
        protocol: "https:",
        host: "example.com",
      })
    ).toBe("/api");
  });

  it("prefers the OrbStack backend WebSocket URL for browser WS calls", () => {
    expect(
      resolveBrowserWsBaseUrl(
        "ws://localhost:3001/ws",
        "http://localhost:3001/api",
        {
          protocol: "https:",
          host: "frontend.almirant.orb.local",
        }
      )
    ).toBe("wss://backend.almirant.orb.local/ws");
  });

  it("falls back to env WebSocket URL outside OrbStack", () => {
    expect(
      resolveBrowserWsBaseUrl(
        "ws://localhost:3001/ws",
        "http://localhost:3001/api",
        {
          protocol: "http:",
          host: "localhost:3000",
        }
      )
    ).toBe("ws://localhost:3001/ws");
  });

  it("derives same-origin WebSocket URL when a tailnet browser receives a loopback WS URL", () => {
    expect(
      resolveBrowserWsBaseUrl(
        "ws://localhost:8081/ws",
        "http://localhost:8081/api",
        {
          protocol: "https:",
          host: "macbook-m1-pro.tail6de2a1.ts.net",
        }
      )
    ).toBe("wss://macbook-m1-pro.tail6de2a1.ts.net/ws");
  });

  it("derives WebSocket URL from a normalized absolute API URL", () => {
    expect(
      resolveBrowserWsBaseUrl(undefined, "https://example.com/api/api/", {
        protocol: "https:",
        host: "example.com",
      })
    ).toBe("wss://example.com");
  });
});
