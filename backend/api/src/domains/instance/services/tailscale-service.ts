import { logger } from "@almirant/config";
import {
  getInstanceConfig,
  updateInstanceConfig,
} from "./instance-config-service";

// ─── Security: command whitelist ──────────────────────────────────────────────
// Only these top-level subcommands are permitted. Any other value is rejected
// before reaching Bun.spawn. The `serve` subcommand has additional validation
// on its trailing argument (see runTailscale).
const ALLOWED_SUBCOMMANDS = new Set(["version", "status", "serve"]);

// For `tailscale serve`, the final positional argument MUST match this pattern.
// This prevents injection of arbitrary URLs or flags via the port parameter.
const SERVE_TARGET_RE = /^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/;

// ─── Availability cache ───────────────────────────────────────────────────────
let availabilityCache: { value: boolean; expiresAt: number } | null = null;
const AVAILABILITY_CACHE_TTL_MS = 30_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

const runTailscale = async (
  args: string[],
  timeoutMs: number,
): Promise<RunResult> => {
  const subcommand = args[0];
  if (!subcommand) {
    return { ok: false, stdout: "", stderr: "empty command" };
  }

  // Security invariant: only whitelisted subcommands are executed
  if (!ALLOWED_SUBCOMMANDS.has(subcommand)) {
    return {
      ok: false,
      stdout: "",
      stderr: `subcommand "${subcommand}" is not in the whitelist`,
    };
  }

  // Security invariant: `serve` subcommand requires a valid target URL as the
  // last argument (or the `status` sub-subcommand, which has no target)
  if (subcommand === "serve") {
    const isStatusCheck = args.includes("status");
    const isRemove = args.includes("--remove");
    const lastArg = args[args.length - 1] ?? "";

    if (!isStatusCheck && !SERVE_TARGET_RE.test(lastArg)) {
      return {
        ok: false,
        stdout: "",
        stderr: `serve target "${lastArg}" does not match allowed pattern`,
      };
    }

    if (!isStatusCheck && !isRemove) {
      const port = parseInt(lastArg.split(":").pop() ?? "", 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { ok: false, stdout: "", stderr: `invalid port in target` };
      }
    }
  }

  let proc: ReturnType<typeof Bun.spawn> | null = null;

  try {
    proc = Bun.spawn(["tailscale", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timer = setTimeout(() => {
      proc?.kill();
    }, timeoutMs);

    const exitCode = await proc.exited;
    clearTimeout(timer);

    const stdoutStream = proc.stdout instanceof ReadableStream ? proc.stdout : null;
    const stderrStream = proc.stderr instanceof ReadableStream ? proc.stderr : null;
    const stdout = stdoutStream ? await new Response(stdoutStream).text() : "";
    const stderr = stderrStream ? await new Response(stderrStream).text() : "";

    return { ok: exitCode === 0, stdout, stderr };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);

    if (
      message.includes("ENOENT") ||
      message.includes("spawn") ||
      message.includes("No such file")
    ) {
      return {
        ok: false,
        stdout: "",
        stderr: "tailscale binary not found in container",
      };
    }

    return { ok: false, stdout: "", stderr: message };
  }
};

const validatePort = (port: number): boolean =>
  Number.isInteger(port) && port >= 1 && port <= 65535;

// ─── Public API ───────────────────────────────────────────────────────────────

export interface TailscaleStatus {
  available: boolean;
  hostname: string | null;
  tailnetName: string | null;
  serveStatus: {
    servingHttps: boolean;
    httpsTarget: string | null;
  } | null;
  suggestedUrl: string | null;
  reason?: string;
}

export const isTailscaleAvailable = async (): Promise<boolean> => {
  const now = Date.now();
  if (availabilityCache && now < availabilityCache.expiresAt) {
    return availabilityCache.value;
  }

  const result = await runTailscale(["version"], 2_000);
  const available = result.ok;

  availabilityCache = { value: available, expiresAt: now + AVAILABILITY_CACHE_TTL_MS };
  return available;
};

export const getTailscaleStatus = async (): Promise<TailscaleStatus> => {
  const available = await isTailscaleAvailable();
  if (!available) {
    return {
      available: false,
      hostname: null,
      tailnetName: null,
      serveStatus: null,
      suggestedUrl: null,
      reason: "tailscale binary not found or not reachable",
    };
  }

  const statusResult = await runTailscale(["status", "--json"], 5_000);
  if (!statusResult.ok) {
    return {
      available: true,
      hostname: null,
      tailnetName: null,
      serveStatus: null,
      suggestedUrl: null,
      reason: `tailscale status failed: ${statusResult.stderr}`,
    };
  }

  let hostname: string | null = null;
  let tailnetName: string | null = null;
  let suggestedUrl: string | null = null;

  try {
    const parsed = JSON.parse(statusResult.stdout);
    hostname = parsed?.Self?.HostName ?? null;

    const magicDns: string | null =
      parsed?.CurrentTailnet?.MagicDNSSuffix ??
      parsed?.MagicDNSSuffix ??
      null;

    tailnetName = magicDns;

    if (hostname && magicDns) {
      suggestedUrl = `https://${hostname}.${magicDns}`;
    }
  } catch {
    logger.warn("Failed to parse tailscale status JSON");
  }

  let serveStatus: TailscaleStatus["serveStatus"] = null;

  const serveResult = await runTailscale(
    ["serve", "status", "--json"],
    5_000,
  );

  if (serveResult.ok) {
    try {
      const serveParsed = JSON.parse(serveResult.stdout);
      const handlers = serveParsed?.TCP ?? serveParsed?.Web ?? {};
      const hasHandlers = Object.keys(handlers).length > 0;

      let httpsTarget: string | null = null;
      if (serveParsed?.TCP?.["443"]?.HTTPS !== undefined) {
        httpsTarget = "443";
      } else if (hasHandlers) {
        const firstKey = Object.keys(handlers)[0];
        httpsTarget = firstKey ?? null;
      }

      serveStatus = {
        servingHttps: hasHandlers,
        httpsTarget,
      };
    } catch {
      logger.warn("Failed to parse tailscale serve status JSON");
    }
  }

  return {
    available: true,
    hostname,
    tailnetName,
    serveStatus,
    suggestedUrl,
  };
};

export const enableTailscaleServe = async (
  targetPort: number,
): Promise<{ success: boolean; publicUrl: string | null; error?: string }> => {
  if (!validatePort(targetPort)) {
    return { success: false, publicUrl: null, error: "Invalid port (must be 1-65535)" };
  }

  const available = await isTailscaleAvailable();
  if (!available) {
    return {
      success: false,
      publicUrl: null,
      error: "tailscale binary not found in container. Use the copy-paste command to run manually on the host.",
    };
  }

  const target = `http://127.0.0.1:${targetPort}`;
  const result = await runTailscale(
    ["serve", "--bg", target],
    10_000,
  );

  if (!result.ok) {
    return {
      success: false,
      publicUrl: null,
      error: `tailscale serve failed: ${result.stderr}`,
    };
  }

  const status = await getTailscaleStatus();

  if (status.suggestedUrl) {
    await updateInstanceConfig({
      tailscaleUrl: status.suggestedUrl,
      tailscaleHostname: status.hostname,
      publicUrl: status.suggestedUrl,
    });
  }

  return { success: true, publicUrl: status.suggestedUrl };
};

export const disableTailscaleServe = async (
  targetPort: number,
): Promise<{ success: boolean; error?: string }> => {
  if (!validatePort(targetPort)) {
    return { success: false, error: "Invalid port (must be 1-65535)" };
  }

  const available = await isTailscaleAvailable();
  if (!available) {
    return { success: false, error: "tailscale binary not found in container" };
  }

  const target = `http://127.0.0.1:${targetPort}`;
  const result = await runTailscale(
    ["serve", "--bg", "--remove", target],
    10_000,
  );

  if (!result.ok) {
    return {
      success: false,
      error: `tailscale serve --remove failed: ${result.stderr}`,
    };
  }

  const config = await getInstanceConfig();
  const tailscaleUrl = config.tailscaleUrl;

  if (config.publicUrl && config.publicUrl === tailscaleUrl) {
    await updateInstanceConfig({
      tailscaleUrl: null,
      tailscaleHostname: null,
      publicUrl: null,
    });
  } else {
    await updateInstanceConfig({
      tailscaleUrl: null,
      tailscaleHostname: null,
    });
  }

  return { success: true };
};

export const getCopyPasteCommand = (targetPort: number): string => {
  // Security: sanitise port to integer in valid range before interpolation
  const port = Math.floor(Number(targetPort));
  if (!validatePort(port)) {
    return "# Invalid port. Must be an integer between 1 and 65535.";
  }
  return `tailscale serve --bg http://127.0.0.1:${port}`;
};
