import type { RuntimeExecutor } from "../shared/types";

const DEFAULT_WORKSPACE_REPO_PATH = "/workspace/repo";

export const piRuntimeExecutor: RuntimeExecutor = {
  codingAgent: "pi",
  runtimeType: "pi-shim",
  platformRuntime: "pi",
  instructionTargets: ["AGENTS.md"],
  resolveRuntimeConfig: (images) => {
    const image = images.piShimImage?.trim();
    if (!image) {
      const error = new Error("Pi shim image is not configured");
      error.name = "PiRuntimeConfigurationError";
      throw error;
    }

    return {
      type: "pi-shim",
      image,
      envVars: {
        SHIM_SERVER_HOST: "0.0.0.0",
        SHIM_SERVER_PORT: String(images.servePort ?? 4096),
        WORKSPACE_REPO_PATH: DEFAULT_WORKSPACE_REPO_PATH,
        PI_CODING_AGENT_DIR: "/tmp/almirant-pi-agent",
        PI_OFFLINE: "1",
        PI_SKIP_VERSION_CHECK: "1",
        PI_TELEMETRY: "0",
      },
    };
  },
};
