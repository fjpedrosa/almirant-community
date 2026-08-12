import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.TEST_DATABASE_URL
  ?? process.env.NOTES_POSTGRES_URL
  ?? "postgres://localhost:5432/postgres";
const apiRoot = fileURLToPath(new URL("../../../", import.meta.url)).replace(/\/$/, "");
const migrationSql = await Bun.file(
  new URL("../../../../packages/database/migrations/0229_green_santa_claus.sql", import.meta.url),
).text();

const parseChildResult = (stdout: string) => {
  const resultLine = stdout.split("\n").find((line) => line.startsWith("NOTES_AUTH_RESULT:"));
  expect(resultLine, stdout).toBeDefined();
  return JSON.parse(resultLine!.slice("NOTES_AUTH_RESULT:".length));
};

describe("Notes production authentication and ACL boundary", () => {
  it("uses canonical REST composition and public MCP authentication against the injected PostgreSQL root", async () => {
    const databaseName = `notes_auth_${process.pid}_${Date.now()}`;
    const admin = postgres(databaseUrl, { max: 1 });
    const target = new URL(databaseUrl);
    target.pathname = `/${databaseName}`;
    const targetUrl = target.toString();
    let sql: ReturnType<typeof postgres> | null = null;

    try {
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
      sql = postgres(targetUrl, { max: 1 });
      await sql.unsafe(`
        CREATE TABLE "user" (
          id text PRIMARY KEY,
          name text NOT NULL,
          email text NOT NULL UNIQUE,
          email_verified boolean NOT NULL DEFAULT false,
          image text,
          role text NOT NULL DEFAULT 'user',
          locale varchar(5) NOT NULL DEFAULT 'en',
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now()
        );
        CREATE TABLE workspace (
          id text PRIMARY KEY,
          name text NOT NULL,
          slug text NOT NULL UNIQUE,
          logo text,
          metadata text,
          created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE TABLE member (
          id text PRIMARY KEY,
          workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
          user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
          role text NOT NULL DEFAULT 'member',
          created_at timestamp NOT NULL DEFAULT now()
        );
        CREATE TABLE session (
          id text PRIMARY KEY,
          expires_at timestamp NOT NULL,
          token text NOT NULL UNIQUE,
          created_at timestamp NOT NULL DEFAULT now(),
          updated_at timestamp NOT NULL DEFAULT now(),
          ip_address text,
          user_agent text,
          user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
          active_workspace_id text REFERENCES workspace(id) ON DELETE SET NULL
        );
        CREATE TABLE agent_jobs (
          id uuid PRIMARY KEY,
          workspace_id text REFERENCES workspace(id) ON DELETE SET NULL,
          status text NOT NULL DEFAULT 'pending'
        );
        INSERT INTO workspace (id, name, slug) VALUES
          ('w1', 'Workspace One', 'workspace-one'),
          ('w2', 'Workspace Two', 'workspace-two');
        INSERT INTO "user" (id, name, email) VALUES
          ('u1', 'Workspace One Owner', 'owner-one@example.test'),
          ('u2', 'Workspace Two Owner', 'owner-two@example.test'),
          ('u3', 'Workspace One Member', 'member-one@example.test'),
          ('u4', 'No Membership', 'none@example.test');
        INSERT INTO member (id, workspace_id, user_id, role) VALUES
          ('m1', 'w1', 'u1', 'owner'),
          ('m2', 'w2', 'u2', 'owner'),
          ('m3', 'w1', 'u3', 'member');
        INSERT INTO session (id, expires_at, token, user_id, active_workspace_id, updated_at) VALUES
          ('s1', now() + interval '1 day', 'token-u1', 'u1', 'w1', now()),
          ('s2', now() + interval '1 day', 'token-u2', 'u2', 'w2', now()),
          ('s3', now() + interval '1 day', 'token-u3', 'u3', 'w1', now()),
          ('s4', now() + interval '1 day', 'token-u4', 'u4', 'w2', now());
      `);
      await sql.unsafe(migrationSql);

      const childScript = String.raw`
        const { Elysia } = await import("elysia");
        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
        const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
        const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
        const { createProtectedApi } = await import("./src/composition/protected-api.ts");
        const { createMcpAuthenticator } = await import("./src/mcp/auth/authenticate.ts");
        const { setupPublicMcpServer } = await import("./src/mcp/setup/public.ts");
        const { generateSessionToken } = await import("./src/shared/services/session-token.ts");
        const database = await import("@almirant/database");

        const ownPage = await database.createNotePage({
          workspaceId: "w1",
          userId: "u1",
          title: "Workspace one private",
          visibility: "private",
        });
        const foreignPage = await database.createNotePage({
          workspaceId: "w2",
          userId: "u2",
          title: "Workspace two private",
          visibility: "private",
        });
        const app = new Elysia().use(createProtectedApi());
        const restRequest = (token, pageId) => app.handle(new Request(
          "http://localhost/api/notes/pages/" + pageId,
          token ? { headers: { cookie: "better-auth.session_token=" + token + ".signed-value" } } : undefined,
        ));
        const restResponses = [];
        for (const [token, pageId] of [
          [null, ownPage.id],
          ["token-u1", ownPage.id],
          ["token-u1", foreignPage.id],
          ["token-u3", ownPage.id],
          ["token-u4", ownPage.id],
        ]) {
          const response = await restRequest(token, pageId);
          restResponses.push({ status: response.status, body: await response.json() });
        }

        const signingSecret = process.env.ENCRYPTION_KEY;
        const tokenFor = (workspaceId, userId) => generateSessionToken({
          workspaceId,
          userId,
          permissions: ["mcp:read", "mcp:write"],
          sessionType: "agent",
          signingSecret,
        });
        const authenticate = createMcpAuthenticator({ allowApiKeys: true, requiredPermission: null });
        const callReadNote = async (token, pageId) => {
          const authentication = await authenticate({ request: new Request("http://localhost/mcp", {
            headers: { authorization: "Bearer " + token },
          }) });
          if (!authentication.authInfo) {
            return { authenticationStatus: authentication.response?.status ?? 500 };
          }
          const server = new McpServer({ name: "notes-production-auth-test", version: "1.0.0" });
          await setupPublicMcpServer(server);
          const client = new Client({ name: "notes-production-auth-client", version: "1.0.0" });
          const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
          const send = clientTransport.send.bind(clientTransport);
          clientTransport.send = (message, options) => send(message, {
            ...options,
            authInfo: authentication.authInfo,
          });
          await server.connect(serverTransport);
          await client.connect(clientTransport);
          try {
            const tools = await client.listTools();
            const result = await client.callTool({ name: "read_note", arguments: { id: pageId } });
            return {
              authenticationStatus: 200,
              auth: {
                clientId: authentication.authInfo.clientId,
                workspaceId: authentication.authInfo.extra?.workspaceId,
                userId: authentication.authInfo.extra?.userId,
                permissions: authentication.authInfo.extra?.permissions,
              },
              registered: tools.tools.some((tool) => tool.name === "read_note"),
              result,
            };
          } finally {
            await client.close();
            await server.close();
          }
        };
        const mcpAllowed = await callReadNote(tokenFor("w1", "u1"), ownPage.id);
        const mcpDenied = await callReadNote(tokenFor("w2", "u2"), ownPage.id);
        const probe = await database.db.execute(database.sql.raw("SELECT current_database() AS name"));
        const probeRows = Array.isArray(probe) ? probe : probe.rows;

        const resultPayload = "NOTES_AUTH_RESULT:" + JSON.stringify({
          apiRoot: process.cwd(),
          composition: createProtectedApi.name,
          databaseName: probeRows[0]?.name,
          ownPageId: ownPage.id,
          foreignPageId: foreignPage.id,
          restResponses,
          mcpAllowed,
          mcpDenied,
        }) + "\n";
        await database.closeConnections();
        await new Promise((resolve, reject) => process.stdout.write(resultPayload, (error) => error ? reject(error) : resolve()));
        process.exit(0);
      `;
      const child = Bun.spawn([process.execPath, "-e", childScript], {
        cwd: apiRoot,
        env: {
          ...process.env,
          DATABASE_URL: targetUrl,
          ENCRYPTION_KEY: "0".repeat(64),
          NODE_ENV: "test",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode, stderr).toBe(0);
      const result = parseChildResult(stdout);

      expect(result.apiRoot).toBe(apiRoot);
      expect(result.composition).toBe("createProtectedApi");
      expect(result.databaseName).toBe(databaseName);
      expect(result.restResponses.map((response: { status: number }) => response.status)).toEqual([
        401,
        200,
        404,
        404,
        403,
      ]);
      expect(result.restResponses[1].body).toEqual(expect.objectContaining({
        success: true,
        data: expect.objectContaining({ id: result.ownPageId, title: "Workspace one private" }),
      }));
      for (const hidden of [result.restResponses[2], result.restResponses[3]]) {
        expect(hidden.body).toEqual(expect.objectContaining({
          success: false,
          code: "NOTE_NOT_FOUND",
          error: "Note not found",
        }));
        expect(JSON.stringify(hidden.body)).not.toContain("Workspace one private");
        expect(JSON.stringify(hidden.body)).not.toContain("Workspace two private");
      }

      expect(result.mcpAllowed.authenticationStatus).toBe(200);
      expect(result.mcpAllowed.auth).toEqual({
        clientId: "session:agent",
        workspaceId: "w1",
        userId: "u1",
        permissions: ["mcp:read", "mcp:write"],
      });
      expect(result.mcpAllowed.registered).toBe(true);
      expect(result.mcpAllowed.result.isError).not.toBe(true);
      expect(JSON.parse(result.mcpAllowed.result.content[0].text)).toEqual(expect.objectContaining({
        id: result.ownPageId,
        title: "Workspace one private",
      }));

      expect(result.mcpDenied.authenticationStatus).toBe(200);
      expect(result.mcpDenied.auth).toEqual({
        clientId: "session:agent",
        workspaceId: "w2",
        userId: "u2",
        permissions: ["mcp:read", "mcp:write"],
      });
      expect(result.mcpDenied.registered).toBe(true);
      expect(result.mcpDenied.result.isError).toBe(true);
      expect(result.mcpDenied.result.content[0].text).toBe("Error: Note not found");
      expect(result.mcpDenied.result.content[0].text).not.toContain("notes access denied");
    } finally {
      await sql?.end().catch(() => undefined);
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  }, 60_000);

  it("returns each committed command snapshot despite an interposed inverse transaction", async () => {
    const databaseName = `notes_command_snapshot_${process.pid}_${Date.now()}`;
    const admin = postgres(databaseUrl, { max: 1 });
    const target = new URL(databaseUrl);
    target.pathname = `/${databaseName}`;
    const targetUrl = target.toString();
    let sql: ReturnType<typeof postgres> | null = null;

    try {
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
      sql = postgres(targetUrl, { max: 1 });
      await sql.unsafe(`
        CREATE TABLE "user" (id text PRIMARY KEY);
        CREATE TABLE workspace (id text PRIMARY KEY);
        CREATE TABLE member (
          id text PRIMARY KEY,
          workspace_id text NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
          user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
        );
        CREATE TABLE agent_jobs (
          id uuid PRIMARY KEY,
          workspace_id text REFERENCES workspace(id) ON DELETE SET NULL
        );
        INSERT INTO workspace (id) VALUES ('w1');
        INSERT INTO "user" (id) VALUES ('u1'), ('u2');
        INSERT INTO member (id, workspace_id, user_id) VALUES
          ('m1', 'w1', 'u1'),
          ('m2', 'w1', 'u2');
      `);
      await sql.unsafe(migrationSql);

      const childScript = String.raw`
        const database = await import("@almirant/database");
        const { createNotesService } = await import("./src/domains/notes/services/notes.service.ts");
        const repository = database.createNotesRepository();
        const owner = { workspaceId: "w1", userId: "u1" };
        const editor = { workspaceId: "w1", userId: "u2" };
        const deferred = () => {
          let resolve;
          const promise = new Promise((settle) => { resolve = settle; });
          return { promise, resolve };
        };
        const capture = async (operation) => {
          try {
            return { response: await operation, error: null };
          } catch (error) {
            return {
              response: null,
              error: {
                name: error?.name,
                code: error?.code,
                status: error?.status,
                message: error?.message,
              },
            };
          }
        };

        const archiveSource = await repository.createPage({
          ...owner,
          title: "archive command source",
        });
        const archiveCommitted = deferred();
        const archiveRelease = deferred();
        const archiveRepository = {
          ...repository,
          updatePage: async (input) => {
            const snapshot = await repository.updatePage(input);
            archiveCommitted.resolve();
            await archiveRelease.promise;
            return snapshot;
          },
        };
        const archiveService = createNotesService(archiveRepository);
        const archiveOperation = capture(archiveService.archivePage(owner, archiveSource.id, {
          expectedVersion: archiveSource.stateVersion,
        }));
        await archiveCommitted.promise;
        let inverseRestore;
        try {
          inverseRestore = await repository.updatePage({
            ...owner,
            pageId: archiveSource.id,
            expectedStateVersion: archiveSource.stateVersion + 1,
            archivedAt: null,
          });
        } finally {
          archiveRelease.resolve();
        }
        const archiveResult = await archiveOperation;
        const archiveFinal = await repository.getPage(owner, archiveSource.id);

        const updateSource = await repository.createPage({
          ...owner,
          title: "shared editor command source",
        });
        await repository.setShare({
          ...owner,
          pageId: updateSource.id,
          sharedWithUserId: editor.userId,
          role: "editor",
        });
        const updateCommitted = deferred();
        const updateRelease = deferred();
        const updateRepository = {
          ...repository,
          updatePage: async (input) => {
            const snapshot = await repository.updatePage(input);
            updateCommitted.resolve();
            await updateRelease.promise;
            return snapshot;
          },
        };
        const updateService = createNotesService(updateRepository);
        const updateOperation = capture(updateService.updatePage(editor, updateSource.id, {
          expectedVersion: updateSource.stateVersion,
          title: "editor committed snapshot",
        }));
        await updateCommitted.promise;
        let inverseArchive;
        try {
          inverseArchive = await repository.updatePage({
            ...owner,
            pageId: updateSource.id,
            expectedStateVersion: updateSource.stateVersion + 1,
            archivedAt: new Date("2026-08-13T11:00:00.000Z"),
          });
        } finally {
          updateRelease.resolve();
        }
        const updateResult = await updateOperation;
        const updateFinal = await repository.getOwnedPageIncludingArchived(owner, updateSource.id);

        const archiveRaceSource = await repository.createPage({
          ...owner,
          title: "concurrent archive source",
        });
        const losingArchiveReady = deferred();
        const losingArchiveRelease = deferred();
        const losingArchiveRepository = {
          ...repository,
          updatePage: async (input) => {
            losingArchiveReady.resolve();
            await losingArchiveRelease.promise;
            return repository.updatePage(input);
          },
        };
        const losingArchiveService = createNotesService(losingArchiveRepository);
        const losingArchiveOperation = capture(losingArchiveService.archivePage(
          owner,
          archiveRaceSource.id,
          { expectedVersion: archiveRaceSource.stateVersion },
        ));
        await losingArchiveReady.promise;
        let winningArchive;
        try {
          winningArchive = await repository.updatePage({
            ...owner,
            pageId: archiveRaceSource.id,
            expectedStateVersion: archiveRaceSource.stateVersion,
            archivedAt: new Date("2026-08-13T12:00:00.000Z"),
          });
        } finally {
          losingArchiveRelease.resolve();
        }
        const losingArchiveResult = await losingArchiveOperation;
        const archiveRaceFinal = await repository.getOwnedPageIncludingArchived(owner, archiveRaceSource.id);

        const reparentRaceParent = await repository.createPage({
          ...owner,
          title: "concurrent reparent destination",
        });
        const reparentRaceSource = await repository.createPage({
          ...owner,
          title: "concurrent reparent source",
        });
        const losingReparentReady = deferred();
        const losingReparentRelease = deferred();
        const losingReparentRepository = {
          ...repository,
          reparent: async (input) => {
            losingReparentReady.resolve();
            await losingReparentRelease.promise;
            return repository.reparent(input);
          },
        };
        const losingReparentService = createNotesService(losingReparentRepository);
        const losingReparentOperation = capture(losingReparentService.reparentPage(
          owner,
          reparentRaceSource.id,
          {
            expectedVersion: reparentRaceSource.stateVersion,
            parentId: reparentRaceParent.id,
          },
        ));
        await losingReparentReady.promise;
        let winningReparentArchive;
        try {
          winningReparentArchive = await repository.updatePage({
            ...owner,
            pageId: reparentRaceSource.id,
            expectedStateVersion: reparentRaceSource.stateVersion,
            archivedAt: new Date("2026-08-13T13:00:00.000Z"),
          });
        } finally {
          losingReparentRelease.resolve();
        }
        const losingReparentResult = await losingReparentOperation;
        const reparentRaceFinal = await repository.getOwnedPageIncludingArchived(owner, reparentRaceSource.id);
        const probe = await database.db.execute(database.sql.raw("SELECT current_database() AS name"));
        const probeRows = Array.isArray(probe) ? probe : probe.rows;

        const payload = "NOTES_AUTH_RESULT:" + JSON.stringify({
          databaseName: probeRows[0]?.name,
          archiveSourceVersion: archiveSource.stateVersion,
          archiveResult,
          inverseRestore,
          archiveFinal,
          updateSourceVersion: updateSource.stateVersion,
          updateResult,
          inverseArchive,
          updateFinal,
          archiveRaceSourceVersion: archiveRaceSource.stateVersion,
          winningArchive,
          losingArchiveResult,
          archiveRaceFinal,
          reparentRaceSourceVersion: reparentRaceSource.stateVersion,
          winningReparentArchive,
          losingReparentResult,
          reparentRaceFinal,
        }) + "\n";
        await database.closeConnections();
        await new Promise((resolve, reject) => process.stdout.write(payload, (error) => error ? reject(error) : resolve()));
        process.exit(0);
      `;
      const child = Bun.spawn([process.execPath, "-e", childScript], {
        cwd: apiRoot,
        env: {
          ...process.env,
          DATABASE_URL: targetUrl,
          ENCRYPTION_KEY: "0".repeat(64),
          NODE_ENV: "test",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exitCode, stderr).toBe(0);
      const result = parseChildResult(stdout);

      expect(result.databaseName).toBe(databaseName);
      expect(result.archiveResult.error).toBeNull();
      expect(result.archiveResult.response).toEqual(expect.objectContaining({
        id: result.archiveFinal.id,
        stateVersion: result.archiveSourceVersion + 1,
        archivedAt: expect.any(String),
        canEdit: false,
        canManageShares: false,
        canReparent: false,
        canArchive: false,
        canChangeVisibility: false,
        canRestore: true,
      }));
      expect(result.inverseRestore).toEqual(expect.objectContaining({
        stateVersion: result.archiveSourceVersion + 2,
        archivedAt: null,
      }));
      expect(result.archiveFinal).toEqual(expect.objectContaining({
        stateVersion: result.archiveSourceVersion + 2,
        archivedAt: null,
      }));

      expect(result.updateResult.error).toBeNull();
      expect(result.updateResult.response).toEqual(expect.objectContaining({
        id: result.updateFinal.id,
        title: "editor committed snapshot",
        stateVersion: result.updateSourceVersion + 1,
        archivedAt: null,
        canEdit: true,
        canManageShares: false,
        canReparent: false,
        canArchive: false,
        canChangeVisibility: false,
        canRestore: false,
      }));
      expect(result.inverseArchive).toEqual(expect.objectContaining({
        stateVersion: result.updateSourceVersion + 2,
        archivedAt: "2026-08-13T11:00:00.000Z",
      }));
      expect(result.updateFinal).toEqual(expect.objectContaining({
        stateVersion: result.updateSourceVersion + 2,
        archivedAt: "2026-08-13T11:00:00.000Z",
        canRestore: true,
      }));

      expect(result.winningArchive).toEqual(expect.objectContaining({
        stateVersion: result.archiveRaceSourceVersion + 1,
        archivedAt: "2026-08-13T12:00:00.000Z",
      }));
      expect(result.losingArchiveResult.response).toBeNull();
      expect(result.losingArchiveResult.error).toEqual(expect.objectContaining({
        name: "NotesServiceError",
        code: "NOTE_VERSION_CONFLICT",
        status: 409,
        message: "Note version conflict",
      }));
      expect(result.archiveRaceFinal).toEqual(expect.objectContaining({
        stateVersion: result.archiveRaceSourceVersion + 1,
        archivedAt: "2026-08-13T12:00:00.000Z",
        canRestore: true,
      }));

      expect(result.winningReparentArchive).toEqual(expect.objectContaining({
        stateVersion: result.reparentRaceSourceVersion + 1,
        archivedAt: "2026-08-13T13:00:00.000Z",
      }));
      expect(result.losingReparentResult.response).toBeNull();
      expect(result.losingReparentResult.error).toEqual(expect.objectContaining({
        name: "NotesServiceError",
        code: "NOTE_VERSION_CONFLICT",
        status: 409,
        message: "Note version conflict",
      }));
      expect(result.reparentRaceFinal).toEqual(expect.objectContaining({
        stateVersion: result.reparentRaceSourceVersion + 1,
        parentId: null,
        archivedAt: "2026-08-13T13:00:00.000Z",
        canRestore: true,
      }));
    } finally {
      await sql?.end().catch(() => undefined);
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  }, 60_000);
});
