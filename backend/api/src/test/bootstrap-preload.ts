/**
 * Test preload: registers the extension point implementations that route tests
 * need, once per test process, before any test file executes.
 *
 * Extension getters (`getPermissionChecker`, `getActivityLogger`,
 * `getRunnerOrchestrator`, etc.) throw when called before the registry has been
 * bootstrapped. Route tests exercise handlers that call those getters, so the
 * registry must be initialised before any test module loads a route.
 *
 * We intentionally register only the three extensions used by route handlers:
 * `permissionChecker`, `activityLogger`, `runnerOrchestrator`. We skip the auth
 * provider registry and the enterprise feedback processor because their
 * default implementations read env at module load via IIFEs — preloading them
 * would defeat the `mock.module("@almirant/config", ...)` calls that the
 * dedicated extension tests rely on (see
 * `src/infrastructure/extensions/__tests__/default-auth-provider-registry.test.ts`).
 *
 * Tests that need a specific implementation of any extension can still
 * override via `set*()` — the registry is last-write-wins.
 *
 * Wired via `bunfig.toml` -> `[test] preload = ["./src/test/bootstrap-preload.ts"]`.
 */
import {
  setPermissionChecker,
  setActivityLogger,
  setRunnerOrchestrator,
} from "@almirant/shared";
import { defaultPermissionChecker } from "../infrastructure/extensions/default-permission-checker";
import { defaultActivityLogger } from "../infrastructure/extensions/default-activity-logger";
import { scalerMetricsRunnerOrchestrator } from "../infrastructure/extensions/scaler-metrics-runner-orchestrator";

setPermissionChecker(defaultPermissionChecker);
setActivityLogger(defaultActivityLogger);
setRunnerOrchestrator(scalerMetricsRunnerOrchestrator);
