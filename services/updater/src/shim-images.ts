import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type ShimName = "opencode" | "claude" | "codex";

interface ManifestEntry {
  repository: string;
  tag: string;
}

type ShimImageManifest = Record<ShimName, ManifestEntry>;

export interface ShimImageTarget {
  name: ShimName;
  service: `${ShimName}-shim`;
  envVar: string;
  repository: string;
  image: string;
}

export interface ShimImageEnvSyncResult {
  appended: Array<{ envVar: string; to: string }>;
  updated: Array<{ envVar: string; from: string; to: string }>;
  skippedCustom: Array<{ envVar: string; value: string; expected: string }>;
}

const SHIM_NAMES: ShimName[] = ["opencode", "claude", "codex"];
const SHIM_ENV_VARS: Record<ShimName, string> = {
  opencode: "OPENCODE_IMAGE",
  claude: "CLAUDE_SHIM_IMAGE",
  codex: "CODEX_SHIM_IMAGE",
};

const isManifestEntry = (value: unknown): value is ManifestEntry => {
  if (!value || typeof value !== "object") return false;

  const entry = value as Record<string, unknown>;
  return typeof entry.repository === "string" && typeof entry.tag === "string";
};

export const loadShimImageTargets = (repoPath: string): ShimImageTarget[] => {
  const manifestPath = join(repoPath, "config", "shim-images.json");
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as Partial<ShimImageManifest>;

  return SHIM_NAMES.map((name) => {
    const entry = manifest[name];
    if (!isManifestEntry(entry)) {
      throw new Error(`Missing shim image manifest entry: ${name}`);
    }

    return {
      name,
      service: `${name}-shim`,
      envVar: SHIM_ENV_VARS[name],
      repository: entry.repository,
      image: `${entry.repository}:${entry.tag}`,
    };
  });
};

const stripInlineComment = (value: string): string =>
  value.split("#", 1)[0].trim();

const isManagedShimImageValue = (
  value: string,
  target: ShimImageTarget,
): boolean => {
  const normalized = stripInlineComment(value).replace(/^["']|["']$/g, "");
  return (
    normalized === "" ||
    normalized === target.repository ||
    normalized.startsWith(`${target.repository}:`)
  );
};

export const syncShimImageEnvFile = (
  repoPath: string,
  envFile: string,
  targets: ShimImageTarget[],
): ShimImageEnvSyncResult => {
  const envPath = join(repoPath, envFile);
  const result: ShimImageEnvSyncResult = {
    appended: [],
    updated: [],
    skippedCustom: [],
  };
  const byEnvVar = new Map(targets.map((target) => [target.envVar, target]));

  if (!existsSync(envPath)) {
    return result;
  }

  const source = readFileSync(envPath, "utf8");
  const hadTrailingNewline = source.endsWith("\n");
  const lines = source.split(/\r?\n/);
  if (hadTrailingNewline) lines.pop();

  const seen = new Set<string>();
  let changed = false;
  const nextLines = lines.map((line) => {
    if (line.trimStart().startsWith("#")) return line;
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) return line;

    const [, envVar, currentValue] = match;
    const target = byEnvVar.get(envVar);
    if (!target) return line;

    seen.add(envVar);
    if (
      stripInlineComment(currentValue).replace(/^["']|["']$/g, "") ===
      target.image
    ) {
      return line;
    }

    if (!isManagedShimImageValue(currentValue, target)) {
      result.skippedCustom.push({
        envVar,
        value: currentValue,
        expected: target.image,
      });
      return line;
    }

    changed = true;
    result.updated.push({ envVar, from: currentValue, to: target.image });
    return `${envVar}=${target.image}`;
  });

  const missing = targets.filter((target) => !seen.has(target.envVar));
  if (missing.length > 0) {
    changed = true;
    nextLines.push(
      "",
      "# ─── Managed by almirant upgrade: shim image versions ──────────",
    );
    for (const target of missing) {
      nextLines.push(`${target.envVar}=${target.image}`);
      result.appended.push({ envVar: target.envVar, to: target.image });
    }
  }

  if (changed) {
    writeFileSync(envPath, `${nextLines.join("\n")}\n`, "utf8");
  }

  return result;
};
