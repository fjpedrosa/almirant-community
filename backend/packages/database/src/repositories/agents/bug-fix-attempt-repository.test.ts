import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildBugFixClaimMetadataSql } from "./bug-fix-attempt-repository";

const dialect = new PgDialect();

describe("buildBugFixClaimMetadataSql", () => {
  test("casts bug-fix claim JSON values to text so Postgres can infer parameter types", () => {
    const query = dialect.sqlToQuery(
      buildBugFixClaimMetadataSql({
        claimToken: "token-123",
        claimedBy: "codex",
        claimedAt: "2026-04-11T22:02:18.004Z",
        expiresAt: "2026-04-11T22:03:18.004Z",
      })
    );

    expect(query.sql).toContain("'token', $1::text");
    expect(query.sql).toContain("'claimedBy', $2::text");
    expect(query.sql).toContain("'claimedAt', $3::text");
    expect(query.sql).toContain("'expiresAt', $4::text");
    expect(query.params).toEqual([
      "token-123",
      "codex",
      "2026-04-11T22:02:18.004Z",
      "2026-04-11T22:03:18.004Z",
    ]);
  });
});
