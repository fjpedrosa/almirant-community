#!/usr/bin/env bun

/**
 * Validates that cross-service features have all their required pieces present.
 * Reads deploy/manifest.json and checks each feature's requirements.
 *
 * Usage:
 *   bun run scripts/validate-deployment.ts
 *
 * Exit codes:
 *   0 = all features have all required pieces
 *   1 = one or more features are missing required pieces
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const MANIFEST_PATH = resolve(ROOT, "deploy/manifest.json");

type Requirement = {
  service: string;
  path: string;
  marker?: string;
};

type RuntimeStatus = "required" | "planned" | "unsupported";

type Feature = {
  description: string;
  requires: Requirement[];
  runtimeSupport?: Record<string, RuntimeStatus>;
};

type Manifest = {
  features: Record<string, Feature>;
};

const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));

let hasErrors = false;
const results: Array<{
  feature: string;
  requirement: string;
  status: "ok" | "missing_file" | "missing_marker";
}> = [];

for (const [featureName, feature] of Object.entries(manifest.features)) {
  for (const req of feature.requires) {
    const fullPath = resolve(ROOT, req.path);

    if (!existsSync(fullPath)) {
      results.push({
        feature: featureName,
        requirement: req.path,
        status: "missing_file",
      });
      hasErrors = true;
      continue;
    }

    if (req.marker) {
      const content = readFileSync(fullPath, "utf-8");
      if (!content.includes(req.marker)) {
        results.push({
          feature: featureName,
          requirement: `${req.path} (marker: "${req.marker}")`,
          status: "missing_marker",
        });
        hasErrors = true;
        continue;
      }
    }

    results.push({
      feature: featureName,
      requirement: req.path,
      status: "ok",
    });
  }
}

// Print results
console.log("\n  Deployment Validation\n");

const grouped = new Map<string, typeof results>();
for (const r of results) {
  const arr = grouped.get(r.feature) ?? [];
  arr.push(r);
  grouped.set(r.feature, arr);
}

for (const [feature, reqs] of grouped) {
  const allOk = reqs.every((r) => r.status === "ok");
  console.log(`${allOk ? "  PASS" : "  FAIL"} ${feature}`);
  for (const r of reqs) {
    const icon = r.status === "ok" ? "    ok" : "    MISSING";
    const suffix =
      r.status === "ok" ? "" : ` [${r.status.replace("_", " ")}]`;
    console.log(`${icon} ${r.requirement}${suffix}`);
  }

  // Show runtime support matrix when present
  const featureDef = manifest.features[feature];
  if (featureDef?.runtimeSupport) {
    const entries = Object.entries(featureDef.runtimeSupport);
    const parts = entries.map(([runtime, status]) => `${runtime}=${status}`);
    console.log(`    runtimes: ${parts.join(", ")}`);
  }
}

console.log("");

if (hasErrors) {
  console.log(
    "FAILED - Deployment validation failed: some features are incomplete\n",
  );
  process.exit(1);
} else {
  console.log(
    "PASSED - Deployment validation passed: all features are complete\n",
  );
  process.exit(0);
}
