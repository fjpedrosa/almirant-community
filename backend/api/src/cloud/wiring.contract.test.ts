import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Static regression pinning the cloud extension seam's three mount points.
 * Community's default implementations under `src/cloud/*` are inert
 * (see their own unit tests), so this file cannot observe cloud behavior
 * through an HTTP/process boundary — it instead source-contract-checks that
 * `bootstrap.ts`, `index.ts` and `background.ts` keep calling into the seam,
 * so a future edit cannot silently remove the extension point downstream
 * distributions (e.g. Almirant Cloud) rely on.
 */
describe("cloud extension seam wiring", () => {
  const apiSrc = resolve(import.meta.dir, "..");

  test("bootstrap.ts registers cloud extensions", () => {
    const source = readFileSync(resolve(apiSrc, "bootstrap.ts"), "utf8");
    expect(source).toContain(
      'import { registerCloudExtensions } from "./cloud/bootstrap-extensions"',
    );
    expect(source).toContain("registerCloudExtensions();");
  });

  test("index.ts mounts the cloud routes seam", () => {
    const source = readFileSync(resolve(apiSrc, "index.ts"), "utf8");
    expect(source).toContain(
      'import { cloudRoutes } from "./cloud/route-registration"',
    );
    expect(source).toContain(".use(cloudRoutes)");
  });

  test("background.ts starts and stops cloud background jobs", () => {
    const source = readFileSync(resolve(apiSrc, "background.ts"), "utf8");
    expect(source).toContain(
      'import { startCloudBackgroundJobs } from "./cloud/background-jobs"',
    );
    expect(source).toContain("startCloudBackgroundJobs();");
    expect(source).toContain("stopCloudBackgroundJobs");
  });
});
