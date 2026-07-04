import { describe, expect, it } from "bun:test";
import {
  seedDetailInitialData,
  seedTraceabilityInitialData,
} from "./detail-initial-data";
import type { SeedWithRelations } from "@/domains/planning/domain/types";

const fullSeed = (): SeedWithRelations =>
  ({
    id: "seed-1",
    title: "Test seed",
    feedbackLinks: [{ id: "f1" }],
    workItemLinks: [{ id: "w1" }],
  } as unknown as SeedWithRelations);

describe("seedDetailInitialData (seed detail query from the list object)", () => {
  it("returns the seed when it carries traceability fields", () => {
    const seed = fullSeed();
    expect(seedDetailInitialData(seed)).toBe(seed);
  });

  it("returns undefined without a list item / when slimmed", () => {
    expect(seedDetailInitialData(null)).toBeUndefined();
    expect(
      seedDetailInitialData({ id: "s" } as unknown as SeedWithRelations),
    ).toBeUndefined();
  });
});

describe("seedTraceabilityInitialData (skip the /:id/traceability GET on open)", () => {
  it("builds { feedbackLinks, workItemLinks } from the list seed (matches API shape)", () => {
    const seed = fullSeed();
    expect(seedTraceabilityInitialData(seed)).toEqual({
      feedbackLinks: seed.feedbackLinks,
      workItemLinks: seed.workItemLinks,
    });
  });

  it("returns undefined when the seed lacks link fields", () => {
    expect(
      seedTraceabilityInitialData({ id: "s" } as unknown as SeedWithRelations),
    ).toBeUndefined();
    expect(seedTraceabilityInitialData(null)).toBeUndefined();
  });
});
