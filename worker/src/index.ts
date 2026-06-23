import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TASK_ID_REGEX = /^MC-\d+$/;

const printHelp = (): void => {
  // Keep help text simple and actionable. No external CLI libs by design.
  console.log(`
Almirant Worker

Usage:
  mc-worker daemon
  mc-worker run <taskId>
  mc-worker validate

Options:
  --help       Show this help
  --version    Show version

Examples:
  bun run worker/src/index.ts daemon
  bun run worker/src/index.ts run MC-123
  bun run worker/src/index.ts validate
`.trim());
};

const readPackageVersion = async (): Promise<string> => {
  const pkgPath = path.resolve(__dirname, "..", "package.json");
  const raw = await readFile(pkgPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error(`Invalid version in ${pkgPath}`);
  }
  return parsed.version;
};

const exitWithError = (message: string): never => {
  console.error(`Error: ${message}\n`);
  printHelp();
  process.exit(1);
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    const version = await readPackageVersion();
    console.log(version);
    return;
  }

  const [command, ...rest] = args;

  if (!command) {
    exitWithError("Missing command.");
  }

  if (command === "daemon") {
    if (rest.length > 0) {
      exitWithError(`"daemon" does not accept arguments (got: ${rest.join(" ")}).`);
    }
    const { startDaemon } = await import("./daemon.js");
    await startDaemon();
    return;
  }

  if (command === "validate") {
    if (rest.length > 0) {
      exitWithError(`"validate" does not accept arguments (got: ${rest.join(" ")}).`);
    }
    const { validateConfig, printValidationResults } = await import("./validate-config.js");
    const results = await validateConfig();
    printValidationResults(results);
    return;
  }

  if (command === "run") {
    if (rest.length !== 1) {
      exitWithError(`"run" requires exactly 1 argument: <taskId>.`);
    }
    const taskId = rest[0] ?? "";
    if (!TASK_ID_REGEX.test(taskId)) {
      exitWithError(`Invalid taskId "${taskId}". Expected format: MC-123`);
    }
    const { runSingleTask } = await import("./run.js");
    await runSingleTask(taskId);
    return;
  }

  exitWithError(`Unknown command "${command}".`);
};

await main();
