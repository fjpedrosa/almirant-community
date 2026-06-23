import { exec } from "node:child_process";
import { access, writeFile, unlink, constants } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig, type WorkerConfig } from "./config.js";
import { createApiClient } from "./api-client.js";

export interface ValidationResult {
  name: string;
  status: "pass" | "warn" | "fail";
  message: string;
}

const checkConfigVariables = async (): Promise<{ results: ValidationResult[]; config: WorkerConfig | null }> => {
  try {
    const config = await loadConfig();
    return {
      results: [
        { name: "MC_API_URL", status: "pass", message: config.apiUrl },
        { name: "MC_API_KEY", status: "pass", message: "configured" },
      ],
      config,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      results: [{ name: "Config", status: "fail", message: msg }],
      config: null,
    };
  }
};

const checkApiConnectivity = async (apiUrl: string): Promise<ValidationResult> => {
  const name = "API connectivity";
  const healthUrl = `${apiUrl.replace(/\/+$/, "")}/health`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const res = await fetch(healthUrl, { method: "GET", signal: controller.signal });
      if (res.ok) {
        return { name, status: "pass", message: `${healthUrl} responded ${res.status}` };
      }
      return { name, status: "fail", message: `${healthUrl} responded ${res.status} ${res.statusText}` };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { name, status: "fail", message: `${healthUrl} timed out after 10s` };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { name, status: "fail", message: `${healthUrl} unreachable: ${msg}` };
  }
};

const execAsync = (cmd: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 5_000 }, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stdout.trim());
    });
  });
};

const checkGitInstalled = async (): Promise<ValidationResult> => {
  const name = "git";
  try {
    const version = await execAsync("git --version");
    return { name, status: "pass", message: version };
  } catch {
    return { name, status: "fail", message: "git is not installed or not in PATH" };
  }
};

const checkRepoBasePath = async (config: WorkerConfig): Promise<ValidationResult> => {
  const name = "Repo base path";
  const repoBase = process.env.WORKER_REPO_BASE_PATH ?? path.join(os.homedir(), "mc-worker-repos");

  try {
    await access(repoBase, constants.R_OK | constants.W_OK);
  } catch {
    return { name, status: "fail", message: `${repoBase} does not exist or is not writable` };
  }

  // Verify write access by creating a temp file
  const tmpFile = path.join(repoBase, `.mc-worker-validate-${Date.now()}`);
  try {
    await writeFile(tmpFile, "check");
    await unlink(tmpFile);
    return { name, status: "pass", message: `${repoBase} exists and is writable` };
  } catch {
    return { name, status: "fail", message: `${repoBase} exists but is not writable` };
  }
};

const checkDiskSpace = async (): Promise<ValidationResult> => {
  const name = "Disk space";
  try {
    const platform = os.platform();
    let output: string;

    if (platform === "win32") {
      return { name, status: "warn", message: "disk space check not supported on Windows" };
    }

    output = await execAsync("df -BG / | tail -1");
    // Example output: /dev/sda1  100G  45G  55G  45% /
    const parts = output.split(/\s+/);
    const availStr = parts[3];
    if (!availStr) {
      return { name, status: "warn", message: "could not parse disk space" };
    }

    const availGB = parseInt(availStr.replace(/[^0-9]/g, ""), 10);
    if (isNaN(availGB)) {
      return { name, status: "warn", message: "could not parse available disk space" };
    }

    if (availGB < 5) {
      return { name, status: "warn", message: `${availGB}GB available (recommended: >= 5GB)` };
    }
    return { name, status: "pass", message: `${availGB}GB available` };
  } catch {
    return { name, status: "warn", message: "could not determine disk space" };
  }
};

const checkProviderKeys = (config: WorkerConfig): ValidationResult => {
  const name = "Provider API keys";
  const providers: string[] = [];

  if (config.anthropicApiKey) providers.push("Anthropic");
  if (config.openaiApiKey) providers.push("OpenAI");

  if (providers.length === 0) {
    return { name, status: "warn", message: "no provider API keys set locally (will try fetching from backend DB)" };
  }

  return { name, status: "pass", message: `configured: ${providers.join(", ")}` };
};

const checkProviderKeysFromBackend = async (config: WorkerConfig): Promise<ValidationResult> => {
  const name = "Provider keys (backend DB)";
  try {
    const client = createApiClient({ apiBaseUrl: config.apiUrl, apiKey: config.apiKey, timeoutMs: 10_000 });
    const resolved = await client.getProviderKeys(["anthropic", "openai"]);
    const okProviders: string[] = [];
    if (resolved.anthropicApiKey) okProviders.push("Anthropic");
    if (resolved.openaiApiKey) okProviders.push("OpenAI");
    if (okProviders.length === 0) {
      return { name, status: "warn", message: "no provider keys available in backend DB (anthropic/openai)" };
    }
    return { name, status: "pass", message: `resolved: ${okProviders.join(", ")}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name, status: "warn", message: `could not resolve from backend: ${msg}` };
  }
};

export const validateConfig = async (): Promise<ValidationResult[]> => {
  const results: ValidationResult[] = [];

  // 1. Check config variables
  const { results: configResults, config } = await checkConfigVariables();
  results.push(...configResults);

  if (!config) {
    // Cannot proceed with remaining checks without a valid config
    return results;
  }

  // 2. Check API connectivity
  results.push(await checkApiConnectivity(config.apiUrl));

  // 3. Check git is installed
  results.push(await checkGitInstalled());

  // 4. Check repo base path
  results.push(await checkRepoBasePath(config));

  // 5. Check disk space
  results.push(await checkDiskSpace());

  // 6. Check provider API keys
  results.push(checkProviderKeys(config));
  if (!config.anthropicApiKey || !config.openaiApiKey) {
    results.push(await checkProviderKeysFromBackend(config));
  }

  return results;
};

export const printValidationResults = (results: ValidationResult[]): void => {
  console.log("\nWorker Configuration Validation\n");

  for (const r of results) {
    const icon = r.status === "pass" ? "[PASS]" : r.status === "warn" ? "[WARN]" : "[FAIL]";
    console.log(`  ${icon} ${r.name}: ${r.message}`);
  }

  const failures = results.filter((r) => r.status === "fail");
  const warnings = results.filter((r) => r.status === "warn");

  console.log("");
  if (failures.length > 0) {
    console.log(`${failures.length} check(s) failed.`);
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.log(`${warnings.length} warning(s). All critical checks passed.`);
  } else {
    console.log("All checks passed.");
  }
};
