import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerNotesTools } from "./notes.tools";
import { NotesServiceError } from "../../domains/notes/services/notes.service";

type Handler = (params: Record<string, any>, extra: Record<string, any>) => Promise<any>;

const registry = (
  service: Record<string, any>,
  isMember: (userId: string, workspaceId: string) => Promise<boolean>,
) => {
  const tools = new Map<string, Handler>();
  const server = {
    tool: (name: string, _description: string, _schema: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  };
  registerNotesTools(server as never, service as never, isMember);
  return tools;
};

const service = () => ({
  searchPages: async (_actor: unknown, _input: Record<string, unknown>): Promise<any> => ({
    items: [],
    pagination: { limit: 20, offset: 0, hasMore: false, nextOffset: null },
  }),
  getPage: async (_actor: unknown) => ({
    id: "10000000-0000-4000-8000-000000000001",
    lexicalJson: { root: { type: "root", children: [] } },
    markdownProjection: "markdown",
    plaintextProjection: "plain",
    canEdit: true,
    canManageShares: false,
    canReparent: false,
    canArchive: false,
    canChangeVisibility: false,
    canRestore: false,
  }),
  createPage: async (_actor: unknown) => ({ id: "created" }),
  updatePage: async (_actor: unknown) => ({ id: "updated" }),
});

const auth = (overrides: Record<string, unknown> = {}) => ({
  authInfo: {
    extra: {
      workspaceId: "workspace-1",
      userId: "human-1",
      permissions: ["mcp:read", "mcp:write"],
      ...overrides,
    },
  },
});

describe("Notes MCP tools", () => {
  it("uses the SDK boundary to reject malformed UUIDs before membership or service access", async () => {
    const notes = service();
    let serviceCalls = 0;
    let membershipCalls = 0;
    notes.getPage = async () => {
      serviceCalls += 1;
      return {} as never;
    };
    notes.createPage = async () => {
      serviceCalls += 1;
      return {} as never;
    };
    notes.updatePage = async () => {
      serviceCalls += 1;
      return {} as never;
    };
    const server = new McpServer({ name: "notes-boundary-test", version: "1.0.0" });
    registerNotesTools(server, notes as never, async () => {
      membershipCalls += 1;
      return true;
    });
    const client = new Client({ name: "notes-boundary-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const send = clientTransport.send.bind(clientTransport);
    clientTransport.send = (message, options) => send(message, {
      ...options,
      authInfo: {
        token: "test-token",
        clientId: "notes-boundary-client",
        scopes: [],
        extra: {
          workspaceId: "workspace-1",
          userId: "human-1",
          permissions: ["mcp:read", "mcp:write"],
        },
      },
    });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const results = await Promise.all([
        client.callTool({ name: "read_note", arguments: { id: "not-a-uuid" } }),
        client.callTool({ name: "update_note", arguments: { id: "not-a-uuid", expectedVersion: 1 } }),
        client.callTool({ name: "create_note", arguments: { parentId: "not-a-uuid" } }),
        client.callTool({ name: "update_note", arguments: { id: "10000000-0000-4000-8000-000000000001", parentId: "not-a-uuid", expectedVersion: 1 } }),
      ]);
      expect(results.every((result) => result.isError === true)).toBe(true);
      expect(results.every((result) => JSON.stringify(result).includes("Invalid arguments"))).toBe(true);
      expect(membershipCalls).toBe(0);
      expect(serviceCalls).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("uses the SDK boundary to reject positions above PostgreSQL int4 before access", async () => {
    const notes = service();
    let serviceCalls = 0;
    let membershipCalls = 0;
    notes.createPage = async () => {
      serviceCalls += 1;
      return {} as never;
    };
    notes.updatePage = async () => {
      serviceCalls += 1;
      return {} as never;
    };
    const server = new McpServer({ name: "notes-position-boundary-test", version: "1.0.0" });
    registerNotesTools(server, notes as never, async () => {
      membershipCalls += 1;
      return true;
    });
    const client = new Client({ name: "notes-position-boundary-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const send = clientTransport.send.bind(clientTransport);
    clientTransport.send = (message, options) => send(message, {
      ...options,
      authInfo: {
        token: "test-token",
        clientId: "notes-position-boundary-client",
        scopes: [],
        extra: {
          workspaceId: "workspace-1",
          userId: "human-1",
          permissions: ["mcp:read", "mcp:write"],
        },
      },
    });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const results = await Promise.all([
        client.callTool({ name: "create_note", arguments: { position: 2_147_483_648 } }),
        client.callTool({
          name: "update_note",
          arguments: {
            id: "10000000-0000-4000-8000-000000000001",
            expectedVersion: 1,
            position: 2_147_483_648,
          },
        }),
      ]);
      expect(results.every((result) => result.isError === true)).toBe(true);
      expect(results.every((result) => JSON.stringify(result).includes("Invalid arguments"))).toBe(true);
      expect(membershipCalls).toBe(0);
      expect(serviceCalls).toBe(0);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns bounded search summaries and pagination without note content", async () => {
    const notes = service();
    let receivedInput: unknown;
    notes.searchPages = async (_actor: unknown, input: Record<string, unknown>) => {
      receivedInput = input;
      return {
        items: [{
          id: "10000000-0000-4000-8000-000000000001",
          title: "Summary",
          parentId: null,
          kind: "page",
          dailyDate: null,
          visibility: "private",
          stateVersion: 3,
          updatedAt: new Date("2026-08-11T00:00:00.000Z"),
          canEdit: true,
          canManageShares: false,
          canReparent: false,
          canArchive: false,
          canChangeVisibility: false,
          canRestore: false,
          lexicalJson: { secret: "must-not-escape" },
          markdownProjection: "must-not-escape",
          plaintextProjection: "must-not-escape",
        }],
        pagination: { limit: 5, offset: 10, hasMore: true, nextOffset: 15 },
      };
    };
    const tools = registry(notes, async () => true);
    const result = await tools.get("search_notes")!({ query: "summary", limit: 5, offset: 10 }, auth());
    const body = JSON.parse(result.content[0].text);
    expect(receivedInput).toEqual({ query: "summary", limit: 5, offset: 10 });
    expect(body.pagination).toEqual({ limit: 5, offset: 10, hasMore: true, nextOffset: 15 });
    expect(body.notes).toEqual([expect.objectContaining({ title: "Summary" })]);
    expect(body.notes[0]).toEqual(expect.objectContaining({
      canEdit: true,
      canManageShares: false,
      canReparent: false,
      canArchive: false,
      canChangeVisibility: false,
      canRestore: false,
    }));
    expect(JSON.stringify(body)).not.toContain("must-not-escape");
  });

  it("returns a bounded content-free receipt for write-only update_note access", async () => {
    const notes = service();
    notes.updatePage = async () => ({
      id: "10000000-0000-4000-8000-000000000001",
      stateVersion: 4,
      updatedAt: "2026-08-12T00:00:00.000Z",
      title: "Secret title",
      lexicalJson: { root: { children: [{ text: "secret" }] } },
    });
    const tools = registry(notes, async () => true);
    const result = await tools.get("update_note")!({
      id: "10000000-0000-4000-8000-000000000001",
      expectedVersion: 3,
      title: "Secret title",
    }, auth({ permissions: ["mcp:write"] }));
    expect(result.isError).not.toBe(true);
    const body = JSON.parse(result.content[0].text);
    expect(body).toEqual({
      id: "10000000-0000-4000-8000-000000000001",
      stateVersion: 4,
      updatedAt: "2026-08-12T00:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("title");
    expect(JSON.stringify(body)).not.toContain("lexicalJson");
  });

  it("registers the public Notes tool contract", () => {
    const tools = registry(service(), async () => true);
    expect([...tools.keys()]).toEqual(["search_notes", "read_note", "create_note", "update_note"]);
    expect(tools.has("convert_legacy_archive")).toBe(false);
    expect(tools.has("discard_legacy_archive")).toBe(false);
  });

  it("checks permission, human user id, and current membership before Notes access", async () => {
    const notes = service();
    let repositoryCalls = 0;
    notes.searchPages = async () => {
      repositoryCalls += 1;
      return {
        items: [],
        pagination: { limit: 20, offset: 0, hasMore: false, nextOffset: null },
      };
    };
    let membershipCalls = 0;
    const tools = registry(notes, async () => {
      membershipCalls += 1;
      return false;
    });

    const missingPermission = await tools.get("search_notes")!(
      { query: "roadmap" },
      auth({ permissions: ["mcp:write"] }),
    );
    const missingHuman = await tools.get("search_notes")!(
      { query: "roadmap" },
      auth({
        userId: undefined,
        sessionType: "worker",
        jobId: "30000000-0000-4000-8000-000000000099",
      }),
    );
    const missingOrg = await tools.get("search_notes")!(
      { query: "roadmap" },
      auth({ workspaceId: undefined }),
    );
    const missingWrite = await tools.get("create_note")!(
      { title: "blocked" },
      auth({ permissions: ["mcp:read"] }),
    );
    const revokedMember = await tools.get("search_notes")!(
      { query: "roadmap" },
      auth(),
    );

    expect(missingPermission.isError).toBe(true);
    expect(missingHuman.isError).toBe(true);
    expect(missingOrg.isError).toBe(true);
    expect(missingWrite.isError).toBe(true);
    expect(revokedMember.isError).toBe(true);
    expect(membershipCalls).toBe(1);
    expect(repositoryCalls).toBe(0);
  });

  it("passes only verified MCP scope and human authority to the shared service", async () => {
    const notes = service();
    const actors: any[] = [];
    notes.createPage = async (actor: unknown) => {
      actors.push(actor);
      return { id: "created" };
    };
    const tools = registry(notes, async () => true);

    await tools.get("create_note")!(
      { title: "API key", lexicalJson: { root: { type: "root", children: [] } }, userId: "attacker" },
      auth({ jobId: "30000000-0000-4000-8000-000000000001" }),
    );
    await tools.get("create_note")!(
      { title: "Agent", lexicalJson: { root: { type: "root", children: [] } } },
      auth({
        sessionType: "agent",
        jobId: "30000000-0000-4000-8000-000000000002",
      }),
    );
    await tools.get("create_note")!(
      { title: "Worker", lexicalJson: { root: { type: "root", children: [] } } },
      auth({
        sessionType: "worker",
        jobId: "30000000-0000-4000-8000-000000000003",
      }),
    );

    expect(actors[0]).toEqual({ workspaceId: "workspace-1", userId: "human-1" });
    expect(actors[1]).toEqual({
      workspaceId: "workspace-1",
      userId: "human-1",
      actorKind: "agent",
      agentJobId: "30000000-0000-4000-8000-000000000002",
      channel: "mcp",
      tool: "create_note",
    });
    expect(actors[2]).toEqual({
      workspaceId: "workspace-1",
      userId: "human-1",
      actorKind: "agent",
      agentJobId: "30000000-0000-4000-8000-000000000003",
      channel: "mcp",
      tool: "create_note",
    });
  });

  it("uses markdown by default and preserves explicit lexical/plain formats", async () => {
    const tools = registry(service(), async () => true);
    const markdown = await tools.get("read_note")!({ id: "note-1" }, auth());
    const lexical = await tools.get("read_note")!({ id: "note-1", format: "lexical" }, auth());
    const plain = await tools.get("read_note")!({ id: "note-1", format: "plain" }, auth());
    expect(JSON.parse(markdown.content[0].text).content).toBe("markdown");
    expect(JSON.parse(markdown.content[0].text)).toEqual(expect.objectContaining({
      canEdit: true,
      canManageShares: false,
      canReparent: false,
      canArchive: false,
      canChangeVisibility: false,
      canRestore: false,
    }));
    expect(JSON.parse(lexical.content[0].text).content).toEqual({ root: { type: "root", children: [] } });
    expect(JSON.parse(plain.content[0].text).content).toBe("plain");
  });

  it("requires expectedVersion for updates at the registered schema boundary", () => {
    const schemas = new Map<string, Record<string, any>>();
    const server = {
      tool: (name: string, _description: string, schema: Record<string, any>) => schemas.set(name, schema),
    };
    registerNotesTools(server as never, service() as never, async () => true);
    const expectedVersion = schemas.get("update_note")?.expectedVersion;
    expect(expectedVersion).toBeDefined();
    expect(expectedVersion.isOptional?.()).not.toBe(true);
  });

  it("keeps inaccessible and unknown failures sanitized", async () => {
    const notes = service();
    notes.getPage = async () => {
      throw new NotesServiceError("NOTE_NOT_FOUND", 404, "Note not found");
    };
    const tools = registry(notes, async () => true);
    const hidden = await tools.get("read_note")!({ id: "secret-note" }, auth());
    expect(hidden.isError).toBe(true);
    expect(hidden.content[0].text).toBe("Error: Note not found");
    expect(hidden.content[0].text).not.toContain("secret-note");

    notes.getPage = async () => {
      throw new Error("SQL SELECT password_hash FROM user");
    };
    const unknown = await tools.get("read_note")!({ id: "secret-note" }, auth());
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).not.toContain("SQL");
    expect(unknown.content[0].text).not.toContain("password_hash");
  });
});
