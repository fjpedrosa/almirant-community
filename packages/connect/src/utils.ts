/**
 * Shared CLI utilities.
 *
 * Keeps the individual provider modules focused on their own logic
 * by extracting cross-cutting helpers here.
 */

import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

/**
 * Locate a binary on the system PATH.
 *
 * @returns The absolute path to the binary, or `null` if not found.
 */
export const which = (bin: string): string | null => {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    return execFileSync(cmd, [bin], { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
};

/**
 * Prompt the user for a single line of text on stdin.
 *
 * Returns `null` when the stream is closed before any input
 * (e.g. the user presses Ctrl+D).
 */
export const prompt = (question: string): Promise<string | null> => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer ?? null);
    });

    // Handle Ctrl+D (EOF) gracefully.
    rl.on("close", () => resolve(null));
  });
};
