/**
 * Claude Max provider.
 *
 * Claude Max subscriptions now need to be connected from the dashboard's
 * OAuth flow so the stored credentials include the scopes required for
 * usage data.
 */

import { which } from "../utils.js";

const CLI_NAME = "claude";
const INSTALL_URL = "https://docs.anthropic.com/en/docs/claude-code/overview";

/**
 * The CLI flow is intentionally disabled because `claude setup-token`
 * produces a setup token that cannot load subscription usage in Almirant.
 */
export const connectClaude = async (): Promise<Record<string, unknown>> => {
  // 1. Verify the Claude CLI is available.
  const cliPath = which(CLI_NAME);
  if (!cliPath) {
    throw new Error(
      `The "${CLI_NAME}" CLI was not found on your PATH.\n` +
        `  Install it first: ${INSTALL_URL}`,
    );
  }

  throw new Error(
    "Claude Max subscriptions must be connected from Almirant Settings > Integrations using the Anthropic OAuth flow. The legacy `claude setup-token` flow does not grant the scopes required for usage bars.",
  );
};
