import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";

const CONFIG_FILE_NAME = "mc-worker.json";

const additionalRepoSchema = z.object({
  repositoryId: z.string().min(1),
  repoPath: z.string().min(1),
  baseBranch: z.string().min(1).optional(),
});

const projectConfigSchema = z
  .object({
    projectId: z.string().min(1),
    repoPath: z.string().min(1),
    baseBranch: z.string().min(1),
    repoUrl: z.string().min(1).optional(),
    additionalRepos: z.array(additionalRepoSchema).optional(),
  })
  .strict();

const fileConfigSchema = z
  .object({
    apiUrl: z.string().min(1),
    apiKey: z.string().min(1),
    workerId: z.string().min(1).optional(),
    maxConcurrentAgents: z.coerce.number().int().positive().default(2),
    providers: z.array(z.string().min(1)).default(["claude-code"]),
    projects: z.array(projectConfigSchema).default([]),
  })
  .strict();

const workerConfigSchema = fileConfigSchema
  .extend({
    // Provider-specific keys are env-only today, but we return them so callers can decide what to do.
    anthropicApiKey: z.string().min(1).optional(),
    openaiApiKey: z.string().min(1).optional(),
    xaiApiKey: z.string().min(1).optional(),
    redisUrl: z.string().min(1).optional(),
    workerId: z.string().min(1),
  })
  .strict();

export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export type WorkerProjectConfig = z.infer<typeof projectConfigSchema>;

const formatZodError = (error: z.ZodError): string => {
  return error.issues
    .map((issue) => {
      const p = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${p}: ${issue.message}`;
    })
    .join("\n");
};

const getCandidateConfigPaths = (cwd: string): string[] => {
  return [path.join(cwd, CONFIG_FILE_NAME), path.join(os.homedir(), CONFIG_FILE_NAME)];
};

const readJsonFile = async (filePath: string): Promise<unknown> => {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${filePath}`);
  }
};

const findAndLoadFileConfig = async (cwd: string): Promise<{ path: string; data: z.infer<typeof fileConfigSchema> } | null> => {
  for (const candidate of getCandidateConfigPaths(cwd)) {
    try {
      const json = await readJsonFile(candidate);
      const parsed = fileConfigSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(`Invalid config file ${candidate}:\n${formatZodError(parsed.error)}`);
      }
      return { path: candidate, data: parsed.data };
    } catch (err) {
      // Only treat missing file as "not found"; other errors are actionable.
      if (err instanceof Error) {
        const msg = err.message.toLowerCase();
        if (msg.includes("enoent") || msg.includes("no such file or directory")) {
          continue;
        }
      }
      throw err;
    }
  }

  return null;
};

const parseEnvInt = (raw: string | undefined, varName: string): number | undefined => {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`${varName} must be a positive integer (got "${raw}")`);
  }
  return n;
};

const normalizeEnvString = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const generateWorkerId = (): string => {
  const host = os.hostname().replace(/\s+/g, "-");
  const rand = randomBytes(4).toString("hex");
  return `${host}-${rand}`;
};

export const loadConfig = async (opts?: { cwd?: string }): Promise<WorkerConfig> => {
  const cwd = opts?.cwd ?? process.cwd();
  const fileConfigResult = await findAndLoadFileConfig(cwd);
  const fileConfig = fileConfigResult?.data;

  const maxConcurrentFromEnv = parseEnvInt(process.env.MC_MAX_CONCURRENT, "MC_MAX_CONCURRENT");

  const merged = {
    ...(fileConfig ?? {}),
    apiUrl: normalizeEnvString(process.env.MC_API_URL) ?? fileConfig?.apiUrl,
    apiKey: normalizeEnvString(process.env.MC_API_KEY) ?? fileConfig?.apiKey,
    workerId: normalizeEnvString(process.env.MC_WORKER_ID) ?? fileConfig?.workerId,
    maxConcurrentAgents: maxConcurrentFromEnv ?? fileConfig?.maxConcurrentAgents ?? 2,
    providers: fileConfig?.providers ?? ["claude-code"],
    projects: fileConfig?.projects ?? [],
    anthropicApiKey: normalizeEnvString(process.env.ANTHROPIC_API_KEY),
    openaiApiKey: normalizeEnvString(process.env.OPENAI_API_KEY),
    xaiApiKey: normalizeEnvString(process.env.XAI_API_KEY),
    redisUrl: normalizeEnvString(process.env.REDIS_URL),
  };

  if (!merged.workerId) {
    merged.workerId = generateWorkerId();
  }

  const parsed = workerConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const sourceHint = fileConfigResult ? `from ${fileConfigResult.path}` : `from env only (no ${CONFIG_FILE_NAME} found)`;
    throw new Error(`Invalid worker config ${sourceHint}:\n${formatZodError(parsed.error)}`);
  }

  return parsed.data;
};
