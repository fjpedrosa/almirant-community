import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkQuotaAvailable, getCurrentUsage } from "@almirant/database";
import type { ProviderQuotaDb } from "@almirant/database";
import { getOrganizationIdFromExtra } from "../setup";

type AiProviderEnum = ProviderQuotaDb["provider"];

export const registerQuotaTools = (server: McpServer) => {
  // -------------------------------------------------------
  // check_quota - Check if quota is available for a provider
  // -------------------------------------------------------
  server.tool(
    "check_quota",
    "Check whether a given AI provider has available quota (tokens, cost, requests). Returns whether usage is allowed and remaining capacity.",
    {
      provider: z
        .string()
        .describe("AI provider to check quota for (e.g. 'anthropic', 'openai')"),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }

        const availability = await checkQuotaAvailable(organizationId, params.provider as AiProviderEnum);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(availability, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error checking quota: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // -------------------------------------------------------
  // get_quota_usage - Get current usage for a provider
  // -------------------------------------------------------
  server.tool(
    "get_quota_usage",
    "Get current quota usage for an AI provider. Returns usage data per active quota period (daily, weekly, monthly) including token counts, cost, and request counts.",
    {
      provider: z
        .string()
        .optional()
        .describe(
          "AI provider to get usage for (e.g. 'anthropic', 'openai'). If omitted, returns usage for all providers."
        ),
    },
    async (params, extra) => {
      try {
        const organizationId = getOrganizationIdFromExtra(extra);
        if (!organizationId) {
          return { content: [{ type: "text" as const, text: "Error: could not resolve organizationId from API key" }], isError: true };
        }

        const providers: AiProviderEnum[] = params.provider
          ? [params.provider as AiProviderEnum]
          : ["anthropic", "openai"];

        const allUsage: Array<{
          provider: string;
          entries: Awaited<ReturnType<typeof getCurrentUsage>>;
        }> = [];

        for (const p of providers) {
          const entries = await getCurrentUsage(organizationId, p);
          allUsage.push({ provider: p, entries });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(allUsage, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting quota usage: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
};
