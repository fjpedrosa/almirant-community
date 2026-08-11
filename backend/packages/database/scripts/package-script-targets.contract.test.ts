import { describe, expect, test } from "bun:test";
import { lstatSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

type Scripts = Record<string, string>;

type MissingTarget = {
  script: string;
  target: string;
};

type ShellToken =
  | { kind: "operator"; value: string }
  | { kind: "word"; value: string };

const packageRoot = resolve(import.meta.dir, "..");
const manifestPath = resolve(packageRoot, "package.json");

function tokenizeShell(command: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let word = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const pushWord = () => {
    if (word.length > 0) {
      tokens.push({ kind: "word", value: word });
      word = "";
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (escaped) {
      word += character;
      escaped = false;
      continue;
    }

    if (quote === "'") {
      if (character === "'") {
        quote = null;
      } else {
        word += character;
      }
      continue;
    }

    if (quote === '"') {
      if (character === '"') {
        quote = null;
      } else if (character === "\\") {
        escaped = true;
      } else {
        word += character;
      }
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "#" && word.length === 0) {
      while (index + 1 < command.length && command[index + 1] !== "\n") {
        index += 1;
      }
      continue;
    }

    if (/\s/.test(character)) {
      pushWord();
      if (character === "\n") {
        tokens.push({ kind: "operator", value: "\n" });
      }
      continue;
    }

    const twoCharacters = command.slice(index, index + 2);
    if (twoCharacters === "&&" || twoCharacters === "||") {
      pushWord();
      tokens.push({ kind: "operator", value: twoCharacters });
      index += 1;
      continue;
    }

    if (character === ";" || character === "|") {
      pushWord();
      tokens.push({ kind: "operator", value: character });
      continue;
    }

    word += character;
  }

  if (escaped || quote !== null) {
    throw new Error(`Unable to parse shell command: ${command}`);
  }

  pushWord();
  return tokens;
}

function splitCommands(command: string): string[][] {
  const commands: string[][] = [];
  let current: string[] = [];

  for (const token of tokenizeShell(command)) {
    if (token.kind === "operator") {
      if (current.length > 0) {
        commands.push(current);
        current = [];
      }
    } else {
      current.push(token.value);
    }
  }

  if (current.length > 0) {
    commands.push(current);
  }

  return commands;
}

function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

function unwrapCommand(words: string[]): string[] {
  let index = 0;

  while (index < words.length && isEnvironmentAssignment(words[index])) {
    index += 1;
  }

  while (index < words.length) {
    const executable = words[index];

    if (executable === "env" || executable === "cross-env") {
      index += 1;
      while (
        index < words.length &&
        (words[index].startsWith("-") ||
          isEnvironmentAssignment(words[index]))
      ) {
        index += 1;
      }
      continue;
    }

    if (
      executable === "command" ||
      executable === "exec" ||
      executable === "time"
    ) {
      index += 1;
      while (index < words.length && words[index].startsWith("-")) {
        index += 1;
      }
      continue;
    }

    break;
  }

  return words.slice(index);
}

function isLocalSourceTarget(token: string): boolean {
  return (
    !token.startsWith("-") &&
    !isEnvironmentAssignment(token) &&
    !token.includes("://") &&
    /\.(?:ts|sh)$/.test(token)
  );
}

function extractTargetsFromCommand(command: string): string[] {
  const targets = new Set<string>();
  const runners = new Set([
    "bash",
    "bun",
    "bunx",
    "dash",
    "deno",
    "node",
    "npx",
    "sh",
    "source",
    "ts-node",
    "tsx",
    "zsh",
  ]);

  for (const commandWords of splitCommands(command)) {
    const words = unwrapCommand(commandWords);
    const executable = words[0];

    if (executable === undefined) {
      continue;
    }

    if (isLocalSourceTarget(executable)) {
      targets.add(executable);
      continue;
    }

    if (!runners.has(executable)) {
      continue;
    }

    const target = words.slice(1).find(isLocalSourceTarget);
    if (target !== undefined) {
      targets.add(target);
    }
  }

  return [...targets].sort();
}

function parseScripts(rawManifest: string): Scripts {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawManifest);
  } catch (error) {
    throw new Error("Unable to parse database package manifest", {
      cause: error,
    });
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("scripts" in parsed) ||
    parsed.scripts === null ||
    typeof parsed.scripts !== "object" ||
    Array.isArray(parsed.scripts)
  ) {
    throw new Error("Database package manifest must contain a scripts object");
  }

  const scripts = Object.entries(parsed.scripts);
  if (scripts.some(([, command]) => typeof command !== "string")) {
    throw new Error("Every database package script command must be a string");
  }

  return Object.fromEntries(scripts) as Scripts;
}

function getTrackedFiles(root: string): Set<string> {
  const result = Bun.spawnSync(["git", "-C", root, "ls-files", "-z", "--", "."], {
    stderr: "pipe",
    stdout: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Unable to inspect tracked database package files: ${result.stderr.toString().trim()}`,
    );
  }

  return new Set(result.stdout.toString().split("\0").filter(Boolean));
}

function findMissingTargets(
  scripts: Scripts,
  targetExists: (target: string) => boolean,
): MissingTarget[] {
  const missing: MissingTarget[] = [];

  for (const [script, command] of Object.entries(scripts)) {
    for (const target of extractTargetsFromCommand(command)) {
      if (!targetExists(target)) {
        missing.push({ script, target });
      }
    }
  }

  return missing.sort(
    (left, right) =>
      left.script.localeCompare(right.script) ||
      left.target.localeCompare(right.target),
  );
}

function isTrackedRegularFile(
  target: string,
  trackedFiles: ReadonlySet<string>,
): boolean {
  const absoluteTarget = resolve(packageRoot, target);
  const relativeTarget = relative(packageRoot, absoluteTarget);

  if (
    relativeTarget === "" ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`)
  ) {
    return false;
  }

  const repositoryPath = relativeTarget.split(sep).join("/");
  if (!trackedFiles.has(repositoryPath)) {
    return false;
  }

  try {
    return lstatSync(absoluteTarget).isFile();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }

    throw new Error(`Unable to inspect database script target: ${target}`, {
      cause: error,
    });
  }
}

describe("database package script targets", () => {
  test("recognizes executable local targets without treating arguments or comments as targets", () => {
    const command = [
      "NODE_ENV=test env FEATURE=on bun run --env-file=.env ./src/task.ts --fixture=./src/not-a-target.ts &&",
      "bash -eu ./scripts/check.sh ||",
      "echo ./src/also-not-a-target.ts ;",
      "npx tsx ./src/fallback.ts\n",
      "./scripts/direct.sh &&",
      "printf ./src/still-not-a-target.ts # bun run ./src/commented.ts",
    ].join(" ");

    expect(extractTargetsFromCommand(command)).toEqual([
      "./scripts/check.sh",
      "./scripts/direct.sh",
      "./src/fallback.ts",
      "./src/task.ts",
    ]);
  });

  test("fails closed for malformed manifests and shell commands", () => {
    expect(() => parseScripts("{")).toThrow(
      "Unable to parse database package manifest",
    );
    expect(() => parseScripts('{"scripts":{"unsafe":false}}')).toThrow(
      "Every database package script command must be a string",
    );
    expect(() => extractTargetsFromCommand("bun run 'src/task.ts")).toThrow(
      "Unable to parse shell command",
    );
  });

  test("reports missing targets by script and target in deterministic order", () => {
    const scripts = {
      second: "bun run src/missing.ts && bash scripts/present.sh",
      first: "./scripts/also-missing.sh",
    };
    const present = new Set(["scripts/present.sh"]);

    expect(findMissingTargets(scripts, (target) => present.has(target))).toEqual([
      { script: "first", target: "./scripts/also-missing.sh" },
      { script: "second", target: "src/missing.ts" },
    ]);
  });

  test("keeps every local TypeScript or shell script target tracked and present", () => {
    const scripts = parseScripts(readFileSync(manifestPath, "utf8"));
    const trackedFiles = getTrackedFiles(packageRoot);

    expect(
      findMissingTargets(scripts, (target) =>
        isTrackedRegularFile(target, trackedFiles),
      ),
    ).toEqual([]);
  });
});
