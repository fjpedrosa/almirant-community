import { describe, expect, it } from "bun:test";
import {
  buildHandbookImportCandidate,
  chunkMarkdownContent,
  slugifyHandbookTitle,
} from "./handbook-importer";

describe("handbook importer helpers", () => {
  it("slugifies titles predictably", () => {
    expect(slugifyHandbookTitle("Autenticación con Better Auth + RBAC"))
      .toBe("autenticacion-con-better-auth-rbac");
  });

  it("builds an import candidate from a markdown path", () => {
    const candidate = buildHandbookImportCandidate({
      rootPath: "/repo/builder-handbook/docs",
      filePath: "/repo/builder-handbook/docs/frontend/backoffice-users.md",
      content: "# Backoffice Users\n\nGestion de usuarios",
    });

    expect(candidate.title).toBe("Backoffice Users");
    expect(candidate.slug).toBe("frontend-backoffice-users");
    expect(candidate.category).toBe("frontend");
    expect(candidate.sourcePath).toBe("frontend/backoffice-users.md");
  });

  it("chunks markdown by headings without losing heading context", () => {
    const chunks = chunkMarkdownContent(`# Auth\nIntro\n\n## Roles\nRBAC details\n\n## Sessions\nSession details`, 30);

    expect(chunks).toHaveLength(3);
    expect(chunks[1]?.headingPath).toBe("Auth > Roles");
    expect(chunks[1]?.content).toContain("RBAC details");
  });
});
