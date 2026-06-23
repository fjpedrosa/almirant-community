import type { RuntimeExecutor } from "../shared/types";

const DEFAULT_WORKSPACE_REPO_PATH = "/workspace/repo";

export const opencodeRuntimeExecutor: RuntimeExecutor = {
  codingAgent: "opencode",
  runtimeType: "opencode",
  platformRuntime: "opencode",
  instructionTargets: ["AGENTS.md"],
  resolveRuntimeConfig: (images) => ({
    type: "opencode",
    image: images.opencodeImage,
    envVars: {
      OPENCODE_HOSTNAME: "0.0.0.0",
      OPENCODE_PORT: String(images.servePort ?? 4096),
      OPENCODE_SERVER_HOST: "0.0.0.0",
      OPENCODE_SERVER_PORT: String(images.servePort ?? 4096),
      WORKSPACE_REPO_PATH: DEFAULT_WORKSPACE_REPO_PATH,
    },
    configFile: "opencode.json",
  }),
};
