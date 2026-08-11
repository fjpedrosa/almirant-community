import { test } from "bun:test";
import { resolve } from "node:path";

const apiRoot = resolve(import.meta.dir, "..");

test("tracked API scripts do not import the retired src/lib/email namespace", () => {
  const result = Bun.spawnSync({
    cmd: [
      "git",
      "grep",
      "-n",
      "--fixed-strings",
      "src/lib/email",
      "--",
      "scripts",
    ],
    cwd: apiRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);

  if (result.exitCode === 1 && stdout.length === 0 && stderr.length === 0) {
    return;
  }

  throw new Error(
    `git grep must report no tracked API script imports (exit ${result.exitCode}).\n${stdout}${stderr}`,
  );
});
