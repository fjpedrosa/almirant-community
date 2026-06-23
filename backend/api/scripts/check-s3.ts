/**
 * S3 Connectivity Diagnostic Script
 *
 * Verifies that the S3 bucket configured in .env is accessible and contains
 * the expected document objects. Useful after bucket renames or migrations.
 *
 * Usage:
 *   cd backend/api && bun run scripts/check-s3.ts
 *   cd backend/api && bun run scripts/check-s3.ts --key docs/some-project/file/hash.md
 *   cd backend/api && bun run scripts/check-s3.ts --prefix doc-assets/
 *   cd backend/api && bun run scripts/check-s3.ts --download docs/some-project/path/hash.md
 */

import {
  S3Client,
  HeadBucketCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  ListBucketsCommand,
} from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// Env loading (lightweight -- avoids importing the full config package which
// requires DATABASE_URL and other vars that may not be set locally)
// ---------------------------------------------------------------------------

const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_REGION = process.env.S3_REGION || "eu-central";
const S3_BUCKET = process.env.S3_BUCKET;
const S3_ENDPOINT = process.env.S3_ENDPOINT;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const ok = (msg: string) => console.log(`${GREEN}[OK]${RESET} ${msg}`);
const fail = (msg: string) => console.error(`${RED}[FAIL]${RESET} ${msg}`);
const warn = (msg: string) => console.warn(`${YELLOW}[WARN]${RESET} ${msg}`);
const info = (msg: string) => console.log(`${CYAN}[INFO]${RESET} ${msg}`);
const heading = (msg: string) => console.log(`\n${BOLD}--- ${msg} ---${RESET}`);

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

const getArgValue = (flag: string): string | undefined => {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
};

const specificKey = getArgValue("--key");
const prefix = getArgValue("--prefix");
const downloadKey = getArgValue("--download");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const main = async () => {
  heading("S3 Configuration Check");

  info(`S3_ACCESS_KEY: ${S3_ACCESS_KEY ? "***" + S3_ACCESS_KEY.slice(-4) : "(not set)"}`);
  info(`S3_SECRET_KEY: ${S3_SECRET_KEY ? "***" + S3_SECRET_KEY.slice(-4) : "(not set)"}`);
  info(`S3_REGION:     ${S3_REGION}`);
  info(`S3_BUCKET:     ${S3_BUCKET || "(not set)"}`);
  info(`S3_ENDPOINT:   ${S3_ENDPOINT || "(not set, using AWS default)"}`);

  if (!S3_ACCESS_KEY || !S3_SECRET_KEY) {
    fail("S3_ACCESS_KEY and S3_SECRET_KEY are required. Set them in backend/api/.env");
    process.exit(1);
  }

  if (!S3_BUCKET) {
    fail("S3_BUCKET is not set. Set it in backend/api/.env");
    process.exit(1);
  }

  // Build S3 client
  const client = new S3Client({
    region: S3_REGION,
    endpoint: S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
    },
    forcePathStyle: !!S3_ENDPOINT,
  });

  // ---- Step 1: List available buckets ----
  heading("Available Buckets");
  try {
    const bucketList = await client.send(new ListBucketsCommand({}));
    const buckets = bucketList.Buckets || [];
    if (buckets.length === 0) {
      warn("No buckets found. The credentials may not have ListBuckets permission, or there are truly no buckets.");
    } else {
      for (const b of buckets) {
        const marker = b.Name === S3_BUCKET ? ` ${GREEN}<-- configured${RESET}` : "";
        info(`  ${b.Name}${marker}`);
      }

      const configuredExists = buckets.some((b) => b.Name === S3_BUCKET);
      if (!configuredExists) {
        fail(
          `Bucket "${S3_BUCKET}" is NOT in the bucket list. ` +
          `Available: ${buckets.map((b) => b.Name).join(", ")}. ` +
          `You likely need to update S3_BUCKET in .env.`
        );
      }
    }
  } catch (err) {
    warn(`ListBuckets failed (may lack permission): ${err instanceof Error ? err.message : String(err)}`);
  }

  // ---- Step 2: HeadBucket -- verify the configured bucket exists and is accessible ----
  heading(`Bucket Accessibility: "${S3_BUCKET}"`);
  try {
    await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    ok(`Bucket "${S3_BUCKET}" is accessible.`);
  } catch (err) {
    const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (error.$metadata?.httpStatusCode === 404 || error.name === "NotFound") {
      fail(`Bucket "${S3_BUCKET}" does NOT exist. Update S3_BUCKET in .env.`);
    } else if (error.$metadata?.httpStatusCode === 403) {
      fail(`Access DENIED to bucket "${S3_BUCKET}". Check credentials and bucket policy.`);
    } else {
      fail(`HeadBucket failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.exit(1);
  }

  // ---- Step 3: List objects ----
  const listPrefix = prefix || specificKey || "";
  heading(`Listing Objects (prefix="${listPrefix || "(none)"}", max 20)`);
  try {
    const listResult = await client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: listPrefix || undefined,
        MaxKeys: 20,
      })
    );

    const objects = listResult.Contents || [];
    info(`Objects returned: ${objects.length} (IsTruncated: ${listResult.IsTruncated})`);

    if (objects.length === 0) {
      warn("No objects found with this prefix. The bucket may be empty or the prefix is wrong.");
    } else {
      for (const obj of objects) {
        const sizeKB = obj.Size ? (obj.Size / 1024).toFixed(1) : "?";
        info(`  ${obj.Key}  (${sizeKB} KB, modified: ${obj.LastModified?.toISOString() || "?"})`);
      }
    }
  } catch (err) {
    fail(`ListObjectsV2 failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ---- Step 3b: List top-level "directories" to give an overview ----
  heading("Top-Level Prefixes (virtual directories)");
  try {
    const listResult = await client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Delimiter: "/",
        MaxKeys: 50,
      })
    );

    const prefixes = listResult.CommonPrefixes || [];
    if (prefixes.length === 0) {
      warn("No top-level prefixes found. Objects may be at root level or bucket is empty.");
    } else {
      for (const p of prefixes) {
        info(`  ${p.Prefix}`);
      }
    }
  } catch (err) {
    fail(`Failed to list prefixes: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ---- Step 4: Download a specific key (if requested) ----
  if (downloadKey) {
    heading(`Download Test: "${downloadKey}"`);
    try {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: S3_BUCKET,
          Key: downloadKey,
        })
      );

      if (!response.Body) {
        fail("Response body is empty.");
      } else {
        const bodyStr = await response.Body.transformToString("utf-8");
        ok(`Downloaded ${bodyStr.length} characters.`);
        info(`Content-Type: ${response.ContentType || "unknown"}`);
        info(`First 500 chars:\n${bodyStr.slice(0, 500)}`);
      }
    } catch (err) {
      const error = err as { name?: string };
      if (error.name === "NoSuchKey") {
        fail(`Key "${downloadKey}" does NOT exist in bucket "${S3_BUCKET}".`);
      } else {
        fail(`GetObject failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ---- Step 5: Quick count of docs/ and doc-assets/ prefixes ----
  heading("Document Prefix Counts");
  for (const docPrefix of ["docs/", "doc-assets/", "docs-sync/", "work-items/"]) {
    try {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: S3_BUCKET,
          Prefix: docPrefix,
          MaxKeys: 1,
        })
      );
      const count = result.KeyCount ?? 0;
      const truncated = result.IsTruncated ? " (more exist)" : "";
      if (count > 0) {
        ok(`"${docPrefix}" - objects found${truncated}`);
      } else {
        warn(`"${docPrefix}" - no objects found`);
      }
    } catch (err) {
      fail(`Error checking "${docPrefix}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  heading("Done");
  info("If the bucket is wrong, update S3_BUCKET in backend/api/.env (and production env vars).");
  info("If objects exist under a different bucket, update S3_BUCKET to point there.");
};

main().catch((err) => {
  fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
