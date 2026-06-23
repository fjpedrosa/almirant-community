/**
 * Legacy S3 bucket migration script.
 *
 * Copies objects from a legacy bucket into the current public/private buckets
 * and rewrites persisted URLs that still point at the legacy bucket.
 *
 * Public prefixes go to S3_BUCKET.
 * Private editor prefixes (`editor-images/`, `editor-files/`) go to S3_PRIVATE_BUCKET.
 *
 * Usage:
 *   cd backend/api
 *   bun run s3:migrate-legacy-bucket
 *   bun run s3:migrate-legacy-bucket -- --execute
 *   bun run s3:migrate-legacy-bucket -- --execute --limit 25
 *   bun run s3:migrate-legacy-bucket -- --execute --prefix work-items/
 */

import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { closeConnections, db, sql } from "@almirant/database";

type S3Config = {
  label: string;
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type MigrationTarget = {
  key: string;
  bucket: string;
  privacy: "public" | "private";
};

const PRIVATE_PREFIXES = ["editor-images/", "editor-files/"];

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

const args = process.argv.slice(2);

const hasFlag = (flag: string) => args.includes(flag);

const getArgValue = (flag: string): string | undefined => {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
};

const printUsage = () => {
  console.log(`
Usage:
  bun run s3:migrate-legacy-bucket [-- --execute] [--prefix <prefix>] [--limit <n>] [--skip-db]

Options:
  --execute       Perform the migration. Without this flag the script runs in dry-run mode.
  --prefix        Only migrate keys under the provided prefix.
  --limit         Stop after processing N objects.
  --skip-db       Copy objects only. Do not rewrite persisted URLs in PostgreSQL.
  --public-only   Migrate only public prefixes.
  --private-only  Migrate only private editor prefixes.
  --help          Show this help.

Required environment:
  Destination (new project):
    S3_BUCKET
    S3_PRIVATE_BUCKET
    S3_ACCESS_KEY
    S3_SECRET_KEY
    S3_REGION
    S3_ENDPOINT

  Source (legacy project / mission-control):
    S3_LEGACY_BUCKET
    S3_LEGACY_ACCESS_KEY
    S3_LEGACY_SECRET_KEY
    S3_LEGACY_REGION
    S3_LEGACY_ENDPOINT

  Database:
    DATABASE_URL
`);
};

const normalizeEndpoint = (endpoint?: string): string | undefined =>
  endpoint ? endpoint.replace(/\/+$/, "") : undefined;

const maskSecret = (value: string | undefined) =>
  value ? `***${value.slice(-4)}` : "(not set)";

const readRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const createClient = (config: S3Config) =>
  new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: !!config.endpoint,
  });

const sameBucketTarget = (a: S3Config, b: S3Config): boolean =>
  a.bucket === b.bucket && (a.endpoint || "") === (b.endpoint || "");

const buildSourceConfig = (): S3Config => ({
  label: "legacy",
  bucket: readRequiredEnv("S3_LEGACY_BUCKET"),
  region: process.env.S3_LEGACY_REGION || "eu-central",
  endpoint: normalizeEndpoint(process.env.S3_LEGACY_ENDPOINT),
  accessKeyId: readRequiredEnv("S3_LEGACY_ACCESS_KEY"),
  secretAccessKey: readRequiredEnv("S3_LEGACY_SECRET_KEY"),
});

const buildPublicDestinationConfig = (): S3Config => ({
  label: "public",
  bucket: readRequiredEnv("S3_BUCKET"),
  region: process.env.S3_REGION || "eu-central",
  endpoint: normalizeEndpoint(process.env.S3_ENDPOINT),
  accessKeyId: readRequiredEnv("S3_ACCESS_KEY"),
  secretAccessKey: readRequiredEnv("S3_SECRET_KEY"),
});

const buildPrivateDestinationConfig = (): S3Config => ({
  label: "private",
  bucket: readRequiredEnv("S3_PRIVATE_BUCKET"),
  region: process.env.S3_REGION || "eu-central",
  endpoint: normalizeEndpoint(process.env.S3_ENDPOINT),
  accessKeyId: readRequiredEnv("S3_ACCESS_KEY"),
  secretAccessKey: readRequiredEnv("S3_SECRET_KEY"),
});

const isPrivateKey = (key: string): boolean =>
  PRIVATE_PREFIXES.some((prefix) => key.startsWith(prefix));

const resolveTarget = (
  key: string,
  publicConfig: S3Config,
  privateConfig: S3Config
): MigrationTarget => {
  if (isPrivateKey(key)) {
    return { key, bucket: privateConfig.bucket, privacy: "private" };
  }

  return { key, bucket: publicConfig.bucket, privacy: "public" };
};

const buildBucketBaseUrls = (config: S3Config): string[] => {
  const urls = new Set<string>();

  if (config.endpoint) {
    urls.add(`${config.endpoint}/${config.bucket}/`);
  }

  urls.add(`https://${config.bucket}.s3.${config.region}.amazonaws.com/`);
  return [...urls];
};

const buildPrimaryBucketBaseUrl = (config: S3Config): string => {
  if (config.endpoint) {
    return `${config.endpoint}/${config.bucket}/`;
  }

  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/`;
};

const assertBucketAccessible = async (client: S3Client, config: S3Config) => {
  try {
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
    ok(`${config.label} bucket "${config.bucket}" is accessible`);
  } catch (error) {
    const err = error as {
      name?: string;
      message?: string;
      $metadata?: { httpStatusCode?: number };
    };
    const status = err.$metadata?.httpStatusCode
      ? ` (HTTP ${err.$metadata.httpStatusCode})`
      : "";
    const detail = err.message ? `: ${err.message}` : "";
    throw new Error(
      `Cannot access ${config.label} bucket "${config.bucket}"` +
        ` with key ${maskSecret(config.accessKeyId)}` +
        ` at ${config.endpoint || "AWS default endpoint"}` +
        `${status}${detail}` +
        (err.name ? ` [${err.name}]` : "")
    );
  }
};

const assertDatabaseAccessible = async () => {
  try {
    await db.execute(sql`select 1 as ok`);
    ok("Database is accessible for URL rewrite");
  } catch (error) {
    const err = error as {
      message?: string;
      cause?: { message?: string; code?: string };
    };
    const causeCode =
      err.cause && typeof err.cause === "object" && "code" in err.cause
        ? err.cause.code
        : undefined;
    const causeMessage =
      err.cause && typeof err.cause === "object" && "message" in err.cause
        ? err.cause.message
        : undefined;

    throw new Error(
      "Cannot access PostgreSQL via DATABASE_URL" +
        (causeCode ? ` [${causeCode}]` : "") +
        (causeMessage ? `: ${causeMessage}` : err.message ? `: ${err.message}` : "") +
        ". Start the target database or rerun with --skip-db if you only want to copy objects."
    );
  }
};

const headObjectSafe = async (
  client: S3Client,
  bucket: string,
  key: string
) => {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
};

const rewritePublicUrlColumns = async (
  sourceBases: string[],
  destinationBase: string,
  dryRun: boolean
) => {
  const tables = [
    {
      label: "projects.screenshot_url",
      tableName: "projects",
      columnName: "screenshot_url",
    },
    {
      label: "expenses.invoice_file_url",
      tableName: "expenses",
      columnName: "invoice_file_url",
    },
    {
      label: "work_item_attachments.file_url",
      tableName: "work_item_attachments",
      columnName: "file_url",
    },
  ] as const;

  for (const table of tables) {
    for (const sourceBase of sourceBases) {
      const preview = await db.execute(sql`
        select count(*)::int as count
        from ${sql.identifier(table.tableName)}
        where ${sql.identifier(table.columnName)} like ${sourceBase + "%"}
      `);

      const count = Number(preview[0]?.count ?? 0);
      if (count === 0) {
        continue;
      }

      info(
        `${table.label}: ${count} rows will be rewritten from ${sourceBase} to ${destinationBase}`
      );

      if (dryRun) {
        continue;
      }

      const result = await db.execute(sql`
        update ${sql.identifier(table.tableName)}
        set ${sql.identifier(table.columnName)} = replace(
          ${sql.identifier(table.columnName)},
          ${sourceBase},
          ${destinationBase}
        )
        where ${sql.identifier(table.columnName)} like ${sourceBase + "%"}
      `);

      const updatedCount = Number(result.count ?? result.length ?? 0);
      ok(`${table.label}: updated ${updatedCount} rows`);
    }
  }
};

const rewritePrivateEditorUrlsInComments = async (
  sourceBases: string[],
  dryRun: boolean
) => {
  const replacements = sourceBases.flatMap((sourceBase) => [
    {
      label: "editor-images",
      from: `${sourceBase}editor-images/`,
      to: "/api/uploads/images/editor-images/",
    },
    {
      label: "editor-files",
      from: `${sourceBase}editor-files/`,
      to: "/api/uploads/files/editor-files/",
    },
  ]);

  const tables = [
    {
      label: "entity_comments.content",
      tableName: "entity_comments",
      columnName: "content",
    },
    {
      label: "idea_item_comments.content",
      tableName: "idea_item_comments",
      columnName: "content",
    },
    {
      label: "comment_versions.content",
      tableName: "comment_versions",
      columnName: "content",
    },
  ] as const;

  for (const table of tables) {
    for (const replacement of replacements) {
      const preview = await db.execute(sql`
        select count(*)::int as count
        from ${sql.identifier(table.tableName)}
        where ${sql.identifier(table.columnName)} like ${"%" + replacement.from + "%"}
      `);

      const count = Number(preview[0]?.count ?? 0);
      if (count === 0) {
        continue;
      }

      info(
        `${table.label}: ${count} rows will replace ${replacement.label} URLs from legacy bucket`
      );

      if (dryRun) {
        continue;
      }

      const result = await db.execute(sql`
        update ${sql.identifier(table.tableName)}
        set ${sql.identifier(table.columnName)} = replace(
          ${sql.identifier(table.columnName)},
          ${replacement.from},
          ${replacement.to}
        )
        where ${sql.identifier(table.columnName)} like ${"%" + replacement.from + "%"}
      `);

      const updatedCount = Number(result.count ?? result.length ?? 0);
      ok(`${table.label}: updated ${updatedCount} rows`);
    }
  }
};

const copyObject = async ({
  sourceClient,
  sourceBucket,
  destinationClient,
  target,
  dryRun,
}: {
  sourceClient: S3Client;
  sourceBucket: string;
  destinationClient: S3Client;
  target: MigrationTarget;
  dryRun: boolean;
}) => {
  const existing = await headObjectSafe(destinationClient, target.bucket, target.key);
  if (existing) {
    return {
      status: "skipped" as const,
      reason: "already_exists",
    };
  }

  if (dryRun) {
    return {
      status: "planned" as const,
      reason: "dry_run",
    };
  }

  const response = await sourceClient.send(
    new GetObjectCommand({
      Bucket: sourceBucket,
      Key: target.key,
    })
  );

  if (!response.Body) {
    throw new Error(`Source object "${target.key}" has an empty body`);
  }

  const body = await response.Body.transformToByteArray();

  await destinationClient.send(
    new PutObjectCommand({
      Bucket: target.bucket,
      Key: target.key,
      Body: body,
      ContentType: response.ContentType,
      CacheControl: response.CacheControl,
      ContentDisposition: response.ContentDisposition,
      ContentEncoding: response.ContentEncoding,
      ContentLanguage: response.ContentLanguage,
      Metadata: response.Metadata,
    })
  );

  return {
    status: "copied" as const,
    reason: "copied",
  };
};

const main = async () => {
  if (hasFlag("--help")) {
    printUsage();
    return;
  }

  const dryRun = !hasFlag("--execute");
  const skipDb = hasFlag("--skip-db");
  const publicOnly = hasFlag("--public-only");
  const privateOnly = hasFlag("--private-only");
  const prefix = getArgValue("--prefix");
  const limitArg = getArgValue("--limit");
  const limit = limitArg ? Number(limitArg) : undefined;

  if (publicOnly && privateOnly) {
    throw new Error("--public-only and --private-only cannot be used together");
  }

  if (limitArg && (!Number.isFinite(limit) || Number(limit) <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  const sourceConfig = buildSourceConfig();
  const publicDestinationConfig = buildPublicDestinationConfig();
  const privateDestinationConfig = buildPrivateDestinationConfig();

  if (sameBucketTarget(sourceConfig, publicDestinationConfig)) {
    throw new Error(
      `Public destination bucket is still pointing to the legacy bucket "${sourceConfig.bucket}". ` +
        `Move the old values to S3_LEGACY_* and set S3_BUCKET to the new public bucket ("almirant").`
    );
  }

  heading("Configuration");
  info(`Mode: ${dryRun ? "dry-run" : "execute"}`);
  info(`Prefix filter: ${prefix || "(none)"}`);
  info(`Limit: ${limit ?? "(none)"}`);
  info(`Rewrite DB URLs: ${skipDb ? "no" : "yes"}`);
  info(
    `Legacy: bucket=${sourceConfig.bucket}, region=${sourceConfig.region}, endpoint=${sourceConfig.endpoint || "(aws default)"}, key=${maskSecret(sourceConfig.accessKeyId)}`
  );
  info(
    `Public destination: bucket=${publicDestinationConfig.bucket}, region=${publicDestinationConfig.region}, endpoint=${publicDestinationConfig.endpoint || "(aws default)"}, key=${maskSecret(publicDestinationConfig.accessKeyId)}`
  );
  info(
    `Private destination: bucket=${privateDestinationConfig.bucket}, region=${privateDestinationConfig.region}, endpoint=${privateDestinationConfig.endpoint || "(aws default)"}, key=${maskSecret(privateDestinationConfig.accessKeyId)}`
  );

  const sourceClient = createClient(sourceConfig);
  const publicDestinationClient = createClient(publicDestinationConfig);
  const privateDestinationClient = createClient(privateDestinationConfig);

  heading("Bucket Access");
  await assertBucketAccessible(sourceClient, sourceConfig);
  await assertBucketAccessible(publicDestinationClient, publicDestinationConfig);
  await assertBucketAccessible(privateDestinationClient, privateDestinationConfig);

  if (!skipDb) {
    heading("Database Access");
    await assertDatabaseAccessible();
  }

  heading("Object Migration");

  let continuationToken: string | undefined;
  let processed = 0;
  let copied = 0;
  let skipped = 0;
  let planned = 0;
  let failed = 0;
  let listed = 0;

  do {
    const page = await sourceClient.send(
      new ListObjectsV2Command({
        Bucket: sourceConfig.bucket,
        Prefix: prefix || undefined,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
    );

    const objects = page.Contents || [];
    listed += objects.length;

    for (const object of objects) {
      const key = object.Key;
      if (!key) {
        continue;
      }

      const privateKey = isPrivateKey(key);
      if (publicOnly && privateKey) {
        continue;
      }
      if (privateOnly && !privateKey) {
        continue;
      }

      if (limit && processed >= limit) {
        continuationToken = undefined;
        break;
      }

      processed++;
      const target = resolveTarget(
        key,
        publicDestinationConfig,
        privateDestinationConfig
      );
      const destinationClient =
        target.privacy === "private"
          ? privateDestinationClient
          : publicDestinationClient;

      try {
        const result = await copyObject({
          sourceClient,
          sourceBucket: sourceConfig.bucket,
          destinationClient,
          target,
          dryRun,
        });

        if (result.status === "copied") {
          copied++;
          ok(`${key} -> ${target.bucket}`);
        } else if (result.status === "planned") {
          planned++;
          info(`[dry-run] ${key} -> ${target.bucket}`);
        } else {
          skipped++;
          info(`[skip] ${key} already exists in ${target.bucket}`);
        }
      } catch (error) {
        failed++;
        fail(
          `${key} -> ${target.bucket}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);

  heading("Migration Summary");
  info(`Listed objects: ${listed}`);
  info(`Processed objects: ${processed}`);
  info(`Copied: ${copied}`);
  info(`Planned: ${planned}`);
  info(`Skipped existing: ${skipped}`);
  info(`Failed: ${failed}`);

  if (!skipDb) {
    heading("Database URL Rewrite");
    const sourcePublicBases = buildBucketBaseUrls(sourceConfig);
    const destinationPublicBase = buildPrimaryBucketBaseUrl(publicDestinationConfig);

    await rewritePublicUrlColumns(sourcePublicBases, destinationPublicBase, dryRun);
    await rewritePrivateEditorUrlsInComments(sourcePublicBases, dryRun);
  } else {
    warn("Skipping database URL rewrite");
  }

  heading("Done");
  if (dryRun) {
    warn("Dry-run only. Re-run with --execute to perform the migration.");
  }
};

main()
  .catch(async (error) => {
    fail(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnections();
  });
