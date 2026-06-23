import type {
  AuthProviderRegistry,
  ActivityLogger,
  PermissionChecker,
  RunnerOrchestrator,
  FeedbackProcessor,
} from "./types";

let _authProviders: AuthProviderRegistry | null = null;
let _activityLogger: ActivityLogger | null = null;
let _permissionChecker: PermissionChecker | null = null;
let _runnerOrchestrator: RunnerOrchestrator | null = null;
let _feedbackProcessor: FeedbackProcessor | null = null;

export function setAuthProviders(impl: AuthProviderRegistry): void {
  _authProviders = impl;
}

export function setActivityLogger(impl: ActivityLogger): void {
  _activityLogger = impl;
}

export function setPermissionChecker(impl: PermissionChecker): void {
  _permissionChecker = impl;
}

export function setRunnerOrchestrator(impl: RunnerOrchestrator): void {
  _runnerOrchestrator = impl;
}

export function setFeedbackProcessor(impl: FeedbackProcessor): void {
  _feedbackProcessor = impl;
}

function required<T>(value: T | null, name: string): T {
  if (value === null) {
    throw new Error(
      `[extensions] ${name} not bootstrapped. ` +
      `Call set${name}(impl) before starting the app.`
    );
  }
  return value;
}

export function getAuthProviders(): AuthProviderRegistry {
  return required(_authProviders, "AuthProviders");
}

export function getActivityLogger(): ActivityLogger {
  return required(_activityLogger, "ActivityLogger");
}

export function getPermissionChecker(): PermissionChecker {
  return required(_permissionChecker, "PermissionChecker");
}

export function getRunnerOrchestrator(): RunnerOrchestrator {
  return required(_runnerOrchestrator, "RunnerOrchestrator");
}

export function getFeedbackProcessor(): FeedbackProcessor {
  return required(_feedbackProcessor, "FeedbackProcessor");
}

export function __resetExtensionsForTests(): void {
  _authProviders = null;
  _activityLogger = null;
  _permissionChecker = null;
  _runnerOrchestrator = null;
  _feedbackProcessor = null;
}
