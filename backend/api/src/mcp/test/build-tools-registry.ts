/**
 * Shared test helper: builds a complete MCP tools registry via a fake server.
 *
 * Callers must set up mock.module() for transitive dependencies BEFORE
 * importing/calling these builders. The dynamic imports inside each builder
 * ensure the mocked modules are resolved at call time.
 *
 * Usage (in a test file):
 *
 *   import { mock } from "bun:test";
 *   import { createDatabaseMocks, createWsMock } from "../../test/mocks";
 *   mock.module("@almirant/database", () => createDatabaseMocks());
 *   // ... other mocks ...
 *
 *   import { buildPublicToolsRegistry } from "./build-tools-registry";
 *   const tools = await buildPublicToolsRegistry();
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export type ToolHandler = (
  params: Record<string, unknown>,
  extra: Record<string, unknown>,
) => Promise<ToolResult>;

// ---------------------------------------------------------------------------
// Fake server factory
// ---------------------------------------------------------------------------

const createFakeServer = (tools: Map<string, ToolHandler>) => ({
  tool: (
    name: string,
    _description: string,
    _schema: unknown,
    handler: ToolHandler,
  ) => {
    tools.set(name, handler);
    return undefined;
  },
});

// ---------------------------------------------------------------------------
// Public tools registry builder
// ---------------------------------------------------------------------------

/**
 * Builds a Map of all tools registered by `setupPublicMcpServer`.
 * Uses dynamic import so callers can set up mocks beforehand.
 */
export const buildPublicToolsRegistry = async (): Promise<
  Map<string, ToolHandler>
> => {
  const tools = new Map<string, ToolHandler>();
  const fakeServer = createFakeServer(tools);

  const { setupPublicMcpServer } = await import("../setup/public");
  await setupPublicMcpServer(fakeServer as never);

  return tools;
};

