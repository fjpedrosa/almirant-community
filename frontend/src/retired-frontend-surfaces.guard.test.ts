import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const FRONTEND_ROOT = resolve(import.meta.dir, "..");

const RETIRED_FRONTEND_TARGETS = [
  "src/domains/contact/application/api/contact-api.ts",
  "src/domains/contact/application/hooks/use-contact-form.ts",
  "src/domains/contact/domain/types.ts",
  "src/domains/contact/presentation/components/contact-form.tsx",
  "src/domains/contact/presentation/containers/contact-form-container.tsx",
  "src/domains/vercel/application/hooks/use-vercel-connect.ts",
  "src/domains/vercel/application/hooks/use-vercel-projects.ts",
  "src/domains/vercel/presentation/components/vercel-connection-button.tsx",
  "src/domains/vercel/presentation/components/vercel-connection-status.tsx",
  "src/domains/vercel/presentation/containers/vercel-settings-container.tsx",
] as const;

const LIVE_FRONTEND_SENTINEL = "src/app/(app-shell)/page.tsx";

describe("retired frontend surface guard", () => {
  test("keeps every retired frontend target absent", () => {
    const existingTargets = RETIRED_FRONTEND_TARGETS.filter((relativePath) =>
      existsSync(resolve(FRONTEND_ROOT, relativePath)),
    );

    expect(existingTargets).toEqual([]);
  });

  test("keeps a live frontend entrypoint and Next config", () => {
    expect(existsSync(resolve(FRONTEND_ROOT, LIVE_FRONTEND_SENTINEL))).toBe(true);
    expect(readFileSync(resolve(FRONTEND_ROOT, "next.config.ts"), "utf8")).toContain(
      "const nextConfig",
    );
  });
});
