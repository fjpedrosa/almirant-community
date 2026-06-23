/**
 * AsyncLocalStorage-based trace context for request-scoped traceId propagation.
 * Follows W3C traceparent semantics: one traceId per causal flow (request/WS-message → job → events).
 */

import { AsyncLocalStorage } from "async_hooks";

export interface TraceContext {
  traceId: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

/**
 * Run a function within a trace context.
 * All code that runs synchronously or asynchronously within `fn` can call
 * `getCurrentTraceId()` to retrieve the traceId without explicit parameter passing.
 */
export const runWithTraceId = <T>(traceId: string, fn: () => T): T => {
  return storage.run({ traceId }, fn);
};

/**
 * Returns the traceId for the current async context, or undefined if none is active.
 * Used by repositories and services to attach the traceId to DB records without
 * changing function signatures.
 */
export const getCurrentTraceId = (): string | undefined => {
  return storage.getStore()?.traceId;
};
