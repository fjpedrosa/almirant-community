import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type ShimName = "opencode" | "claude" | "codex";

type ShimImageManifest = Record<
  ShimName,
  {
    repository: string;
    tag: string;
  }
>;

const rootDir = join(import.meta.dir, "..");
const manifestPath = join(rootDir, "config", "shim-images.json");

const manifest = JSON.parse(
  readFileSync(manifestPath, "utf8"),
) as ShimImageManifest;

const expectedTagByRepository = new Map(
  Object.values(manifest).map(({ repository, tag }) => [repository, tag]),
);

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  "dist",
  "node_modules",
]);

const scannedExtensions = new Set([
  ".example",
  ".json",
  ".md",
  ".ts",
  ".yml",
  ".yaml",
]);

const explicitFiles = new Set([
  ".env.example",
  ".env.production.example",
  "docker-compose.yml",
  "docker-compose.local.yml",
  "docker-compose.prod.yml",
]);

const shimImagePattern =
  /(almirant-(?:opencode|claude|codex)-shim):(latest|[0-9]+(?:\.[0-9]+){1,3}(?:[-\w.]+)?)/g;

const isScannableFile = (relativePath: string): boolean => {
  if (explicitFiles.has(relativePath)) return true;

  for (const extension of scannedExtensions) {
    if (relativePath.endsWith(extension)) return true;
  }

  return false;
};

const listFiles = (directory: string): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFiles(absolutePath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = relative(rootDir, absolutePath);
    if (isScannableFile(relativePath)) {
      files.push(absolutePath);
    }
  }

  return files;
};

const errors: string[] = [];

for (const file of listFiles(rootDir)) {
  if (statSync(file).size > 1_000_000) {
    continue;
  }

  const content = readFileSync(file, "utf8");
  const relativePath = relative(rootDir, file);

  for (const match of content.matchAll(shimImagePattern)) {
    const [, repository, tag] = match;
    const expectedTag = expectedTagByRepository.get(repository);

    if (!expectedTag) {
      continue;
    }

    if (tag !== expectedTag) {
      errors.push(
        `${relativePath}: expected ${repository}:${expectedTag}, found ${repository}:${tag}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Shim image version drift detected:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

const resolved = Object.values(manifest)
  .map(({ repository, tag }) => `${repository}:${tag}`)
  .join(", ");

console.log(`Shim image references are aligned: ${resolved}`);
