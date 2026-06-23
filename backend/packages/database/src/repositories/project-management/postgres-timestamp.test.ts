import { describe, expect, it } from "bun:test";
import { toPostgresTimestamptzParam } from "./postgres-timestamp";

describe("toPostgresTimestamptzParam", () => {
  it("serializes Date values as ISO strings accepted by Postgres timestamptz", () => {
    const cutoff = new Date("2026-05-03T20:27:49.000Z");

    expect(toPostgresTimestamptzParam(cutoff)).toBe(
      "2026-05-03T20:27:49.000Z",
    );
  });

  it("does not serialize using the JS Date display format rejected by Postgres", () => {
    const cutoff = new Date("2026-05-03T20:27:49.000Z");

    expect(toPostgresTimestamptzParam(cutoff)).not.toContain("GMT");
    expect(toPostgresTimestamptzParam(cutoff)).not.toContain(
      "Coordinated Universal Time",
    );
  });

  it("rejects invalid Date values before they reach SQL parameters", () => {
    expect(() => toPostgresTimestamptzParam(new Date("invalid"))).toThrow(
      "Invalid timestamp",
    );
  });
});
