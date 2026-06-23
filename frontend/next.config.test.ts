import { describe, expect, it } from "bun:test";
import type { NextConfig } from "next";
import { buildCustomRoute } from "next/dist/lib/build-custom-route";
import type { Rewrite } from "next/dist/lib/load-custom-routes";
import nextConfig from "./next.config";

const getBeforeFilesRewrites = async (): Promise<Rewrite[]> => {
  const rewrites = await (nextConfig as NextConfig).rewrites?.();

  if (!rewrites || Array.isArray(rewrites)) {
    throw new Error("Expected grouped rewrites in next.config");
  }

  return rewrites.beforeFiles as Rewrite[];
};

const getBackendApiCatchAll = async (): Promise<Rewrite> => {
  const beforeFiles = await getBeforeFilesRewrites();
  const rewrite = beforeFiles.find(
    (route) =>
      route.source.startsWith("/api/:path") &&
      route.destination.endsWith("/api/:path*"),
  );

  if (!rewrite) {
    throw new Error("Expected backend API catch-all rewrite");
  }

  return rewrite;
};

describe("next.config production output", () => {
  it("emits standalone runtime files for Docker deployments", () => {
    expect((nextConfig as NextConfig).output).toBe("standalone");
  });
});

describe("next.config rewrites", () => {
  it("keeps frontend-owned API routes in Next before proxying backend API calls", async () => {
    const rewrite = await getBackendApiCatchAll();
    const { regex } = buildCustomRoute("rewrite", rewrite);
    const matchesBackendApiProxy = (pathname: string) =>
      new RegExp(regex).test(pathname);

    expect(matchesBackendApiProxy("/api/auth/session")).toBe(false);
    expect(matchesBackendApiProxy("/api/ws-token")).toBe(false);
    expect(matchesBackendApiProxy("/api/users/me")).toBe(true);
    expect(matchesBackendApiProxy("/api/projects/123")).toBe(true);
  });
});
