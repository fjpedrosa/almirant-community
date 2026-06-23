import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const loadMessages = (locale: "en" | "es") =>
  JSON.parse(
    readFileSync(join(import.meta.dir, "../../../../messages", `${locale}.json`), "utf8"),
  ) as {
    github: {
      appSetup: Record<string, unknown>;
      addRepositories?: unknown;
      manageInstallations?: unknown;
    };
  };

describe("GitHub settings translations", () => {
  it.each(["en", "es"] as const)("defines visible GitHub App management actions for %s", (locale) => {
    const messages = loadMessages(locale);

    expect(messages.github.appSetup.reconfigure).toBeString();
    expect(messages.github.addRepositories).toBeString();
    expect(messages.github.manageInstallations).toBeString();
  });
});
