import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (name: string): string =>
  readFileSync(resolve(import.meta.dir, name), "utf8");

const registrySource = readSource("runtime-capability-registry.ts");
const runtimeSelectionSource = readSource("runtime-selection.ts");
const legacyAdapterSource = readSource("legacy-runtime-selection-adapter.ts");
const memoryReservationSource = readSource("memory-reservation.ts");
const foundationSources = [
  registrySource,
  runtimeSelectionSource,
  legacyAdapterSource,
  memoryReservationSource,
  readSource("runtime-capability-intent.ts"),
  readSource("runner-claim-admission.ts"),
  readSource("runtime-evidence.ts"),
  readSource("runtime-failure.ts"),
].join("\n");

describe("shared runtime capability architecture", () => {
  it("keeps compatibility defaults in the named legacy adapter", () => {
    expect(legacyAdapterSource).toContain("LEGACY_PROVIDER_DEFAULTS");
    expect(runtimeSelectionSource).toContain("resolveLegacyRuntimeSelection");
    expect(registrySource).not.toContain("LEGACY_PROVIDER_DEFAULTS");
  });

  it("keeps the production registry runtime-neutral", () => {
    expect(registrySource).not.toMatch(/from\s+["'](?:node:|bun:)/);
    expect(registrySource).not.toMatch(/from\s+["'][^"']*(?:database|drizzle|postgres)/i);
    expect(registrySource).not.toMatch(/\b(?:Bun|process)\./);
  });

  it("contains no Cloud-only paths, deltas, scaler concepts, or migration identities", () => {
    expect(foundationSources).not.toMatch(/(?:\.\.\/)*cloud\//i);
    expect(foundationSources).not.toContain("CLOUD_DELTA");
    expect(foundationSources).not.toMatch(/\bscaler\b/i);
    expect(foundationSources).not.toMatch(/migration[_-]?identity/i);
  });

  it("keeps existing Community Plan Review and resource exports", () => {
    const indexSource = readFileSync(resolve(import.meta.dir, "../index.ts"), "utf8");
    expect(indexSource).toContain('export * from "./agents/plan-review"');
    expect(indexSource).toContain('export * from "./agents/resource-estimation"');
  });
});
