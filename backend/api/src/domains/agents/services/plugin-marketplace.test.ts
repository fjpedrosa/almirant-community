import { describe, expect, it } from "bun:test";
import {
  normalizeClaudeMarketplaceSource,
  parseClaudeMarketplaceCatalog,
} from "./plugin-marketplace";

describe("Claude plugin marketplace parser", () => {
  it("normalizes GitHub shorthand and direct HTTPS catalogs", () => {
    expect(normalizeClaudeMarketplaceSource("anthropics/claude-plugins-official")).toEqual({
      cliSource: "anthropics/claude-plugins-official",
      catalogUrl:
        "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json",
    });

    expect(
      normalizeClaudeMarketplaceSource(
        "https://plugins.example.com/.claude-plugin/marketplace.json",
      ),
    ).toEqual({
      cliSource: "https://plugins.example.com/.claude-plugin/marketplace.json",
      catalogUrl: "https://plugins.example.com/.claude-plugin/marketplace.json",
    });
  });

  it("parses only installable entries and preserves provider metadata", () => {
    const catalog = parseClaudeMarketplaceCatalog({
      name: "acme-plugins",
      owner: { name: "Acme" },
      plugins: [
        {
          name: "quality-review",
          source: "./plugins/quality-review",
          description: "Reviews changes",
          version: "1.2.3",
          category: "quality",
          tags: ["review"],
        },
        { name: "invalid entry" },
      ],
    });

    expect(catalog).toEqual({
      name: "acme-plugins",
      ownerName: "Acme",
      plugins: [
        {
          externalId: "quality-review",
          name: "quality-review",
          description: "Reviews changes",
          version: "1.2.3",
          category: "quality",
          tags: ["review"],
          source: "./plugins/quality-review",
        },
      ],
    });
  });

  it("rejects malformed or oversized catalogs", () => {
    expect(() => parseClaudeMarketplaceCatalog({ plugins: [] })).toThrow();
    expect(() =>
      parseClaudeMarketplaceCatalog({
        name: "too-many",
        plugins: Array.from({ length: 501 }, (_, index) => ({
          name: `plugin-${index}`,
          source: `./plugins/${index}`,
        })),
      }),
    ).toThrow("500");
  });

  it("caches only bounded provider source metadata and skips unsafe relative sources", () => {
    const catalog = parseClaudeMarketplaceCatalog({
      name: "secure-plugins",
      plugins: [
        {
          name: "safe-plugin",
          source: {
            source: "git-subdir",
            url: "https://github.com/acme/plugins.git",
            path: "plugins/safe-plugin",
            ref: "main",
            sha: "abc123",
            arbitrary: { deeply: { nested: "payload" } },
          },
        },
        { name: "escape-plugin", source: "../outside" },
      ],
    });

    expect(catalog.plugins).toHaveLength(1);
    expect(catalog.plugins[0]?.source).toEqual({
      source: "git-subdir",
      url: "https://github.com/acme/plugins.git",
      path: "plugins/safe-plugin",
      ref: "main",
      sha: "abc123",
    });
  });

  it("rejects duplicate install identifiers", () => {
    expect(() =>
      parseClaudeMarketplaceCatalog({
        name: "duplicates",
        plugins: [
          { name: "review", source: "./plugins/one" },
          { name: "review", source: "./plugins/two" },
        ],
      }),
    ).toThrow("duplicate plugin");
  });
});
