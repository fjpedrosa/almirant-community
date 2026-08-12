import { describe, expect, it } from "bun:test";

const apiIndex = await Bun.file(new URL("../../index.ts", import.meta.url)).text();
const protectedApi = await Bun.file(
  new URL("../../composition/protected-api.ts", import.meta.url),
).text();
const publicMcpSetup = await Bun.file(
  new URL("../../mcp/setup/public.ts", import.meta.url),
).text();
const restAdapter = await Bun.file(new URL("./routes/notes.routes.ts", import.meta.url)).text();
const mcpAdapter = await Bun.file(new URL("../../mcp/tools/notes.tools.ts", import.meta.url)).text();

describe("Notes adapter registration", () => {
  it("mounts REST only inside authenticated workspace routes and MCP on the public server", () => {
    expect(apiIndex).toContain('import { createProtectedApi } from "./composition/protected-api"');
    expect(apiIndex).toContain(".use(createProtectedApi())");
    expect(protectedApi).toContain('import { notesModule } from "../domains/notes"');
    const authenticatedGroup = protectedApi.slice(protectedApi.indexOf(".use(sessionAuthMiddleware)"));
    expect(authenticatedGroup.indexOf(".use(requireAuth)")).toBeLessThan(
      authenticatedGroup.indexOf(".use(requireWorkspace)"),
    );
    const workspaceGroup = protectedApi.slice(protectedApi.indexOf(".use(requireWorkspace)"));
    expect(workspaceGroup).toContain(".use(notesModule.protected())");
    expect(publicMcpSetup).toContain('import { registerNotesTools } from "../tools/notes.tools"');
    expect(publicMcpSetup).toContain("registerNotesTools(server)");
  });

  it("keeps REST and MCP thin around the same service instead of database access", () => {
    expect(restAdapter).toContain("service: NotesService = notesService");
    expect(mcpAdapter).toContain("service: NotesMcpService = notesService");
    expect(restAdapter).not.toContain("createNotesRepository");
    expect(mcpAdapter).not.toContain("createNotesRepository");
  });
});
