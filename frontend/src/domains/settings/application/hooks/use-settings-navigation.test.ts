import { describe, expect, it } from "bun:test";
import { deriveActiveSection, sectionConfig } from "./use-settings-navigation";

describe("settings navigation", () => {
  it("exposes scoped provider sections instead of a standalone GitHub settings section", () => {
    expect(sectionConfig.some((section) => section.id === "code-providers")).toBe(true);
    expect(sectionConfig.some((section) => section.id === "ai-providers")).toBe(true);
    expect(sectionConfig.some((section) => section.id === "agent-providers")).toBe(true);
    expect(sectionConfig.some((section) => section.id === "github")).toBe(false);
  });

  it("maps legacy provider routes to their new scoped sections", () => {
    expect(deriveActiveSection("/settings/github")).toBe("code-providers");
    expect(deriveActiveSection("/settings/provider-keys")).toBe("ai-providers");
    expect(deriveActiveSection("/settings/providers")).toBe("ai-providers");
    expect(deriveActiveSection("/settings/agents")).toBe("agent-providers");
    expect(deriveActiveSection("/settings/vercel")).toBe("integrations");
  });
});
