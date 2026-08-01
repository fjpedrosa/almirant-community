import { describe, expect, test } from "bun:test";

import {
  REQUIRED_TEST_DATABASE_RELATIONS,
  UNIT_TEST_DATABASE_URL,
  createBackendTestEnvironment,
  findMissingRequiredDatabaseRelations,
  selectBackendTests,
} from "./backend-test-selector";

describe("selectBackendTests", () => {
  const files = [
    "src/zeta.test.ts",
    "src/agents/recovery.db.test.ts",
    "scripts/backend-test-selector.test.ts",
    "src/alpha.test.tsx",
    "src/agents/reclaim.db.test.tsx",
    "src/zeta.test.ts",
  ];

  test("runs unit tests and skips real-DB suites when TEST_DATABASE_URL is absent", () => {
    expect(selectBackendTests(files, undefined)).toEqual({
      unit: [
        "scripts/backend-test-selector.test.ts",
        "src/alpha.test.tsx",
        "src/zeta.test.ts",
      ],
      database: [],
      skippedDatabase: [
        "src/agents/reclaim.db.test.tsx",
        "src/agents/recovery.db.test.ts",
      ],
    });
  });

  test("includes real-DB suites only when TEST_DATABASE_URL is explicit", () => {
    expect(
      selectBackendTests(files, "postgresql://test:test@localhost:5432/test"),
    ).toEqual({
      unit: [
        "scripts/backend-test-selector.test.ts",
        "src/alpha.test.tsx",
        "src/zeta.test.ts",
      ],
      database: [
        "src/agents/reclaim.db.test.tsx",
        "src/agents/recovery.db.test.ts",
      ],
      skippedDatabase: [],
    });
  });

  test("does not accept an empty TEST_DATABASE_URL as DB opt-in", () => {
    expect(selectBackendTests(files, "   ").database).toEqual([]);
  });
});

describe("createBackendTestEnvironment", () => {
  test("forces a non-routable dummy DATABASE_URL for unit tests", () => {
    const env = createBackendTestEnvironment(
      {
        DATABASE_URL: "postgresql://production.example/app",
        TEST_DATABASE_URL: "postgresql://test.example/test",
        KEEP_ME: "yes",
      },
      "unit",
    );

    expect(env.DATABASE_URL).toBe(UNIT_TEST_DATABASE_URL);
    expect(env.TEST_DATABASE_URL).toBeUndefined();
    expect(env.KEEP_ME).toBe("yes");
  });

  test("uses only explicit TEST_DATABASE_URL for real-DB suites", () => {
    const env = createBackendTestEnvironment(
      {
        DATABASE_URL: "postgresql://ignored.example/app",
        TEST_DATABASE_URL: "postgresql://test.example/prepared",
      },
      "database",
    );

    expect(env.DATABASE_URL).toBe("postgresql://test.example/prepared");
    expect(env.TEST_DATABASE_URL).toBe(
      "postgresql://test.example/prepared",
    );
  });

  test("rejects a DB run without explicit TEST_DATABASE_URL", () => {
    expect(() =>
      createBackendTestEnvironment(
        { DATABASE_URL: "postgresql://ambient.example/app" },
        "database",
      ),
    ).toThrow("TEST_DATABASE_URL");
  });

  test("rejects non-PostgreSQL TEST_DATABASE_URL values", () => {
    expect(() =>
      createBackendTestEnvironment(
        { TEST_DATABASE_URL: "https://database.example/test" },
        "database",
      ),
    ).toThrow("PostgreSQL");
  });
});

describe("findMissingRequiredDatabaseRelations", () => {
  test("reports every required relation absent from the prepared schema", () => {
    const present = REQUIRED_TEST_DATABASE_RELATIONS.filter(
      (relation) => relation !== "agent_jobs" && relation !== "work_items",
    );

    expect(findMissingRequiredDatabaseRelations(present)).toEqual([
      "agent_jobs",
      "work_items",
    ]);
  });
});
