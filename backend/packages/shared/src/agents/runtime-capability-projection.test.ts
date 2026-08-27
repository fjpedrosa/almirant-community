import { describe, expect, it } from "bun:test";
import {
  canonicalStringifyRuntimeCapabilityValue,
  runtimeCapabilityRegistry,
} from "./runtime-capability-registry";
import {
  runtimeCapabilityProjection as generatedRuntimeCapabilityProjection,
} from "./runtime-capability-projection.generated";
import {
  assertRuntimeCapabilityProjectionArtifactsCurrent,
  buildRuntimeCapabilityProjectionArtifacts,
} from "../../../../../scripts/generate-runtime-capability-projection";

const frontendProjectionPath = `${import.meta.dir}/../../../../../frontend/src/generated/runtime-capability-projection.v1.json`;

const sorted = (values: readonly string[]): string[] => [...values].sort();

describe("generated runtime capability projection", () => {
  it("keeps generated TypeScript and frontend JSON in exact version/hash/data parity", async () => {
    const frontendProjection = await Bun.file(frontendProjectionPath).json();

    expect(frontendProjection).toEqual(generatedRuntimeCapabilityProjection);
    expect(generatedRuntimeCapabilityProjection).toEqual(
      runtimeCapabilityRegistry.projection,
    );
    expect(generatedRuntimeCapabilityProjection.schemaVersion).toBe(
      "runtime-capability-projection-v1",
    );
    expect(generatedRuntimeCapabilityProjection.version).toBe(
      runtimeCapabilityRegistry.version,
    );
    expect(generatedRuntimeCapabilityProjection.hash).toBe(
      runtimeCapabilityRegistry.projectionHash,
    );
  });

  it("emits canonical sorted JSON and canonical sorted projection rows", async () => {
    const artifacts = buildRuntimeCapabilityProjectionArtifacts();
    const frontendJson = await Bun.file(frontendProjectionPath).text();
    const projection = generatedRuntimeCapabilityProjection;

    expect(frontendJson).toBe(artifacts.frontendJson);
    expect(frontendJson.endsWith("\n")).toBe(true);
    expect(frontendJson).toBe(
      `${canonicalStringifyRuntimeCapabilityValue(projection, 2)}\n`,
    );
    expect(projection.codingAgents).toEqual(sorted(projection.codingAgents));
    expect(projection.aiProviders).toEqual(sorted(projection.aiProviders));
    expect(projection.authClasses).toEqual(sorted(projection.authClasses));
    expect(projection.capabilityIds).toEqual(sorted(projection.capabilityIds));
    expect(projection.defaults).toEqual(
      runtimeCapabilityRegistry.modelCatalogs
        .map((catalog) => ({
          aiProvider: catalog.aiProvider,
          model: catalog.defaultModel,
        }))
        .sort((left, right) => left.aiProvider.localeCompare(right.aiProvider)),
    );
    expect("modelCatalogs" in projection).toBe(false);

    const tupleKeys = projection.tuples.map(
      (tuple) => `${tuple.codingAgent}\u0000${tuple.aiProvider}\u0000${tuple.model}`,
    );
    expect(tupleKeys).toEqual(sorted(tupleKeys));
  });

  it("check mode detects TypeScript, JSON, and hash drift without rewriting", async () => {
    const artifacts = buildRuntimeCapabilityProjectionArtifacts();

    expect(() =>
      assertRuntimeCapabilityProjectionArtifactsCurrent({
        generatedTypescript: artifacts.generatedTypescript,
        frontendJson: artifacts.frontendJson,
      }),
    ).not.toThrow();

    expect(() =>
      assertRuntimeCapabilityProjectionArtifactsCurrent({
        generatedTypescript: `${artifacts.generatedTypescript}\n// drift\n`,
        frontendJson: artifacts.frontendJson,
      }),
    ).toThrow("runtime-capability-projection.generated.ts is stale");

    const hashDrift = artifacts.frontendJson.replace(
      runtimeCapabilityRegistry.projectionHash,
      "sha256:stale",
    );
    expect(() =>
      assertRuntimeCapabilityProjectionArtifactsCurrent({
        generatedTypescript: artifacts.generatedTypescript,
        frontendJson: hashDrift,
      }),
    ).toThrow("runtime-capability-projection.v1.json is stale");
  });

  it("contains no credential fields, secret-like values, or user-specific paths", () => {
    const artifacts = buildRuntimeCapabilityProjectionArtifacts();
    const serialized = `${artifacts.generatedTypescript}\n${artifacts.frontendJson}`;

    expect(serialized).not.toMatch(
      /"(?:apiKey|authorization|credential|password|privateKey|refreshToken|secret|token)"\s*:/i,
    );
    expect(serialized).not.toMatch(
      /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]+|\b(?:ghp_|xox[baprs]-|sk-)[A-Za-z0-9])/i,
    );
    expect(serialized).not.toMatch(
      /(?:\/Users\/|\/home\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\)/,
    );
  });

  it("keeps generated production TypeScript environment-neutral", async () => {
    const source = await Bun.file(
      `${import.meta.dir}/runtime-capability-projection.generated.ts`,
    ).text();

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\b(?:Bun|process)\./);
  });
});
