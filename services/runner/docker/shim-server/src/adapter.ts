import type {
  PromptRequest,
  SessionCreateInput,
  SessionCreateResponse,
  SSEEvent,
} from "./types.js";
import type { CanonicalEvent } from "@almirant/canonical-events";

export type RuntimeEventListener = (event: SSEEvent) => void;
export type CanonicalEventListener = (event: CanonicalEvent) => void;
export type NativeRuntimeEvent = {
  nativeEventType: string;
  sourceFormat: string;
  runtimeSessionId?: string;
  emittedAt?: string;
  provider?: string;
  codingAgent?: string;
  payload: Record<string, unknown>;
};
export type NativeEventListener = (event: NativeRuntimeEvent) => void;

export interface RuntimeAdapter {
  createSession(input: SessionCreateInput): Promise<SessionCreateResponse>;
  sendPrompt(sessionId: string, request: PromptRequest): Promise<void>;
  onEvent(listener: RuntimeEventListener): () => void;
  onCanonicalEvent?(listener: CanonicalEventListener): () => void;
  onNativeEvent?(listener: NativeEventListener): () => void;
  listSessions?(): Promise<SessionCreateResponse[]>;
  getSession?(sessionId: string): Promise<SessionCreateResponse | null>;
  deleteSession?(sessionId: string): Promise<boolean>;
}
