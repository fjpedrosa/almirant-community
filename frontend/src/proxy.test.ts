import { describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";

mock.module("better-auth/cookies", () => ({
  getSessionCookie: (request: NextRequest) =>
    request.cookies.get("better-auth.session_token")?.value ?? null,
}));

import { proxy } from "./proxy";

describe("proxy", () => {
  it("allows /waitlist without session cookie", async () => {
    const response = await proxy(new NextRequest("http://localhost/waitlist"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows /signup without session cookie", async () => {
    const response = await proxy(new NextRequest("http://localhost/signup"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows public metadata and asset files without session cookie", async () => {
    const responses = await Promise.all([
      proxy(new NextRequest("http://localhost/robots.txt")),
      proxy(new NextRequest("http://localhost/sitemap.xml")),
      proxy(new NextRequest("http://localhost/llms.txt")),
      proxy(new NextRequest("http://localhost/og-image.png")),
      proxy(new NextRequest("http://localhost/icon.svg")),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("redirects private routes to /sign-in when session cookie is missing", async () => {
    const response = await proxy(new NextRequest("http://localhost/boards"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/sign-in");
  });

  it("does not redirect MCP requests before Next rewrites proxy them to the backend", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/mcp", { method: "POST" })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows OAuth discovery paths so MCP clients can probe the backend", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/.well-known/oauth-protected-resource")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("allows private routes when session cookie exists", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/boards", {
        headers: {
          cookie: "better-auth.session_token=valid-token",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("returns 405 for POST to root marketing route", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/", { method: "POST" })
    );

    expect(response.status).toBe(405);
  });

  it("returns 405 for POST to /pricing", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/pricing", { method: "POST" })
    );

    expect(response.status).toBe(405);
  });

  it("allows GET to root marketing route", async () => {
    const response = await proxy(new NextRequest("http://localhost/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("returns 404 for system paths like /.well-known", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/.well-known/something")
    );

    expect(response.status).toBe(404);
  });
});
