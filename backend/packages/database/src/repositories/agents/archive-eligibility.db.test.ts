import { describe, expect, test } from "bun:test";
import { getAgentJobsEligibleForNativeArchive } from "./agent-job-event-archive-repository";
import { getPlanningSessionsEligibleForArchive } from "../ideation/planning-session-repository";

// Both queries bind a JS Date against a coalesce() expression, which has no
// column type mapper: the driver rejected the raw Date and every sweep failed.
describe("archive eligibility (real PostgreSQL)", () => {
  test("agent job eligibility binds the retention cutoff", async () => {
    const rows = await getAgentJobsEligibleForNativeArchive(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      5,
    );

    expect(Array.isArray(rows)).toBe(true);
  });

  test("planning session eligibility binds the retention cutoff", async () => {
    const rows = await getPlanningSessionsEligibleForArchive(
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      5,
    );

    expect(Array.isArray(rows)).toBe(true);
  });
});
