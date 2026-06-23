import type {
  RuntimeExecutor,
  RuntimeExecutorRegistry,
  RuntimeType,
} from "../shared/types";
import { claudeRuntimeExecutor } from "./claude";
import { codexRuntimeExecutor } from "./codex";
import { opencodeRuntimeExecutor } from "./opencode";

const EXECUTORS: RuntimeExecutor[] = [
  claudeRuntimeExecutor,
  codexRuntimeExecutor,
  opencodeRuntimeExecutor,
];

const executorByRuntimeType = new Map<RuntimeType, RuntimeExecutor>(
  EXECUTORS.map((executor) => [executor.runtimeType, executor]),
);

const executorByCodingAgent = new Map<string, RuntimeExecutor>(
  EXECUTORS.map((executor) => [executor.codingAgent, executor]),
);

const normalizeProvider = (provider: string): string => provider.trim().toLowerCase();

const resolveRuntimeTypeFromProvider = (provider: string): RuntimeType => {
  switch (normalizeProvider(provider)) {
    case "anthropic":
    case "claude-code":
    case "zipu":
    case "zai":
      return "claude-shim";
    case "openai":
    case "codex":
      return "codex-shim";
    case "grok":
    case "xai":
      return "opencode";
    default:
      return "opencode";
  }
};

export const createRuntimeExecutorRegistry = (): RuntimeExecutorRegistry => {
  return {
    resolve: ({ provider, codingAgent }) => {
      if (codingAgent) {
        const executor = executorByCodingAgent.get(codingAgent);
        if (executor) {
          return executor;
        }
      }

      return (
        executorByRuntimeType.get(resolveRuntimeTypeFromProvider(provider)) ??
        opencodeRuntimeExecutor
      );
    },
    resolveByRuntimeType: (runtimeType) => {
      return executorByRuntimeType.get(runtimeType) ?? opencodeRuntimeExecutor;
    },
  };
};
