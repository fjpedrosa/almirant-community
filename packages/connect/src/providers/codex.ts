/**
 * OpenAI Codex (ChatGPT Pro) provider.
 *
 * Connects a ChatGPT Pro subscription by running `codex login --device-auth`
 * and reading the resulting auth file.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { which } from "../utils.js";

const CLI_NAME = "codex";
const AUTH_FILE = join(homedir(), ".codex", "auth.json");
const INSTALL_URL = "https://github.com/openai/codex";

/**
 * Guide the user through `codex login --device-auth` and return credentials.
 *
 * After the interactive login completes the auth tokens are read from
 * `~/.codex/auth.json` and returned as the credential payload.
 */
export const connectCodex = async (): Promise<Record<string, unknown>> => {
  // 1. Verify the Codex CLI is available.
  const cliPath = which(CLI_NAME);
  if (!cliPath) {
    throw new Error(
      `The "${CLI_NAME}" CLI was not found on your PATH.\n` +
        `  Install it first: ${INSTALL_URL}`,
    );
  }

  console.log();
  console.log("[*] Running \`codex login --device-auth\`...");
  console.log(
    "    Follow the instructions in your browser to authorize the connection.",
  );
  console.log();

  // 2. Spawn the interactive device-auth login command.
  const result = spawnSync(CLI_NAME, ["login", "--device-auth"], {
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(
      `Failed to run "${CLI_NAME} login --device-auth": ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    throw new Error(
      `"${CLI_NAME} login --device-auth" exited with code ${result.status ?? "unknown"}.`,
    );
  }

  // 3. Read the auth file that the CLI writes on success.
  let raw: string;
  try {
    raw = readFileSync(AUTH_FILE, "utf-8");
  } catch {
    throw new Error(
      `Login appeared to succeed but the auth file was not found at:\n` +
        `  ${AUTH_FILE}\n` +
        `  Please try again or file an issue.`,
    );
  }

  let authJson: Record<string, unknown>;
  try {
    authJson = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(
      `The auth file at ${AUTH_FILE} contains invalid JSON.\n` +
        `  Please delete it and try again.`,
    );
  }

  return {
    ...authJson,
    authMethod: "subscription",
  };
};
