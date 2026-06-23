export {
  type AgentOutputEventType,
  type AgentOutputEvent,
  type StreamPublisherConfig,
  type StreamReaderConfig,
  type RetryConfig,
  type StreamConsumerMetrics,
  DEFAULT_STREAM_NAME,
  DEFAULT_DLQ_STREAM_NAME,
  DEFAULT_MAX_LEN,
} from "./types";

export {
  type StreamPublisher,
  createStreamPublisher,
} from "./stream-publisher";

export {
  type RetryTracker,
  createRetryTracker,
} from "./retry-tracker";

export {
  type DeadLetterHandler,
  createDeadLetterHandler,
} from "./dead-letter-handler";

export {
  type IdempotencyGuard,
  createIdempotencyGuard,
} from "./idempotency-guard";

export {
  type StreamCleanerConfig,
  type StreamCleaner,
  createStreamCleaner,
} from "./stream-cleaner";

export {
  type HealthReporter,
  createHealthReporter,
} from "./health-reporter";

export {
  type StreamReaderHandler,
  type StreamReader,
  createStreamReader,
  parseEvent,
} from "./stream-reader";

// Canonical event types (v2)
export {
  type CanonicalEvent,
  type CanonicalEventKind,
  type CanonicalEventEnvelope,
  type NativeEventEnvelope,
  type AgentThinkingEvent,
  type AgentTextEvent,
  type AgentTextCompleteEvent,
  type AgentToolCallStartEvent,
  type AgentToolCallResultEvent,
  type AgentFileReadEvent,
  type AgentFileWriteEvent,
  type AgentFileEditEvent,
  type AgentBashExecuteEvent,
  type AgentBashOutputEvent,
  type AgentSubagentSpawnEvent,
  type AgentSubagentCompleteEvent,
  type AgentWaveStartEvent,
  type AgentWaveDoneEvent,
  type AgentWaveEndEvent,
  type AgentQuestionEvent,
  type AgentPermissionRequestEvent,
  type AgentStepEvent,
  type SessionConnectedEvent,
  type SessionIdleEvent,
  type SessionAwaitingUserEvent,
  type SessionErrorEvent,
  type SessionClosedEvent,
  type JobStartedEvent,
  type JobCompletedEvent,
  type JobIncompleteEvent,
  type JobFailedEvent,
  type JobCancelledEvent,
  type JobTimeoutEvent,
  type HeartbeatEvent,
  type SystemInfoEvent,
  type SystemWarnEvent,
  type MessageQueuedCanonical,
  type MessageDequeuedCanonical,
} from "./canonical-events";

export {
  serializeCanonicalEnvelope,
  deserializeCanonicalEnvelope,
  isCanonicalFormat,
  serializeNativeEnvelope,
  deserializeNativeEnvelope,
  isNativeFormat,
} from "./canonical-serializer";

export {
  createCanonicalStreamEvent,
  createNativeStreamEvent,
  readStreamEvent,
  type StreamReadResult,
} from "./stream-io";

// Bridge renderer interface and canonical router
export {
  type BridgeRenderer,
  type BridgeRendererContext,
  type BridgeRendererConfig,
  createCanonicalRouter,
} from "./bridge-renderer";

// Generic coalescer
export {
  type CoalescedBatch,
  type ExtraExtractor,
  type CoalescerConfig,
  type Coalescer,
  createCoalescer,
} from "./coalescer";

// Canonical text/thinking coalescer (runner-side)
export {
  type CanonicalTextCoalescer,
  type CanonicalTextCoalescerConfig,
  createCanonicalTextCoalescer,
} from "./canonical-text-coalescer";
