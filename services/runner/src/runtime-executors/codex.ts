import type { RuntimeExecutor } from "../shared/types";

const DEFAULT_WORKSPACE_REPO_PATH = "/workspace/repo";

export const codexRuntimeExecutor: RuntimeExecutor = {
  codingAgent: "codex",
  runtimeType: "codex-shim",
  platformRuntime: "codex",
  instructionTargets: ["CLAUDE.md", "AGENTS.md"],
  resolveRuntimeConfig: (images) => ({
    type: "codex-shim",
    image: images.codexShimImage,
    envVars: {
      OPENCODE_SERVER_HOST: "0.0.0.0",
      OPENCODE_SERVER_PORT: String(images.servePort ?? 4096),
      WORKSPACE_REPO_PATH: DEFAULT_WORKSPACE_REPO_PATH,
    },
  }),
};
