import { Elysia } from "elysia";

/**
 * Elysia plugin that responds 404 to any method on `/mcp/internal` when the
 * internal mount is disabled.
 *
 * Why this exists: elysia-mcp's public `/mcp` mount matches `/mcp/internal`
 * by prefix when no exact `/mcp/internal` route is registered, so requests
 * silently resolve against the public tool set. That makes a misconfigured
 * env look like "internal tools are missing from the server", which is a
 * nightmare to debug (we lost about an hour on it the first time).
 *
 * This guard MUST be registered BEFORE the `/mcp` public mount so that the
 * Elysia router picks the more-specific `/mcp/internal` route first.
 */
export const disabledInternalMcpMount = new Elysia({ name: "disabled-internal-mcp-mount" })
  .all("/mcp/internal", ({ set }) => {
    set.status = 404;
    return {
      success: false,
      error:
        "MCP internal mount is disabled. Set MCP_INTERNAL_ENABLED=true in the backend env and redeploy to enable /mcp/internal.",
    };
  });
