import { describe, expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const envModuleUrl = pathToFileURL(join(import.meta.dir, "env.ts")).href;

async function readPiCodingAgentAdmissionEnabled(
  value: string | undefined,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const environment: Record<string, string> = {
    ...(Bun.env as Record<string, string>),
    DATABASE_URL: "postgresql://pi-admission-probe:x@127.0.0.1:1/x",
  };
  if (value === undefined) {
    delete environment.PI_CODING_AGENT_ADMISSION_ENABLED;
  } else {
    environment.PI_CODING_AGENT_ADMISSION_ENABLED = value;
  }

  const script =
    `import { env } from ${JSON.stringify(envModuleUrl)};\n` +
    `console.log(JSON.stringify({ value: env.PI_CODING_AGENT_ADMISSION_ENABLED }));\n`;
  const proc = Bun.spawn(["bun", "--no-env-file", "-e", script], {
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("env: PI_CODING_AGENT_ADMISSION_ENABLED", () => {
  test('defaults to "true" for compatibility', async () => {
    const result = await readPiCodingAgentAdmissionEnabled(undefined);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ value: "true" });
  });

  test.each(["true", "false"])(
    'accepts the exact startup value "%s"',
    async (value) => {
      const result = await readPiCodingAgentAdmissionEnabled(value);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({ value });
    },
  );

  test("rejects invalid startup values instead of coercing them", async () => {
    const result = await readPiCodingAgentAdmissionEnabled("yes");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("PI_CODING_AGENT_ADMISSION_ENABLED");
    expect(result.stdout).toBe("");
  });
});
