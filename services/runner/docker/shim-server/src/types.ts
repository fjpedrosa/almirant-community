export type SessionCreateInput = {
  cwd: string;
  model?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
};

export type SessionCreateResponse = {
  id: string;
  status?: string;
  cwd?: string;
  model?: string;
  provider?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};

export type CanonicalMappingResult<TEvent = import("@almirant/canonical-events").CanonicalEvent> = {
  events: TEvent[];
  terminal?: boolean;
  requiresInput?: boolean;
};

export type PromptPart = {
  type: "text";
  text: string;
};

export type PromptRequest = {
  parts: PromptPart[];
};

export type MessagePartDeltaEvent = {
  type: "message.part.delta";
  properties: {
    sessionId?: string;
    delta: string;
    contentType?: "thinking" | "text" | "tool_use";
  };
};

export type MessagePartUpdatedEvent = {
  type: "message.part.updated";
  properties: {
    sessionId?: string;
    contentType?: "thinking" | "text" | "tool_use";
    part: {
      text: string;
    };
  };
};

export type SessionIdleEvent = {
  type: "session.idle";
  properties: {
    sessionId?: string;
  };
};

export type QuestionAskedEvent = {
  type: "question.asked";
  properties: {
    sessionId?: string;
    text: string;
    options?: string[];
    questions?: Array<{
      text: string;
      options: string[];
    }>;
  };
};

export type SessionStatusEvent = {
  type: "session.status";
  properties: {
    sessionId?: string;
    status: string;
    message?: string;
  };
};

export type ServerHeartbeatEvent = {
  type: "server.heartbeat";
  properties: {
    timestamp: string;
  };
};

export type ServerConnectedEvent = {
  type: "server.connected";
  properties: {
    timestamp: string;
  };
};

export type MessageQueuedEvent = {
  type: "message.queued";
  properties: {
    sessionId?: string;
    messageId: string;
    position: number;
    queueDepth: number;
  };
};

export type MessageDequeuedEvent = {
  type: "message.dequeued";
  properties: {
    sessionId?: string;
    messageId: string;
    remainingInQueue: number;
  };
};

export type SSEEvent =
  | MessagePartDeltaEvent
  | MessagePartUpdatedEvent
  | SessionIdleEvent
  | QuestionAskedEvent
  | SessionStatusEvent
  | ServerHeartbeatEvent
  | ServerConnectedEvent
  | MessageQueuedEvent
  | MessageDequeuedEvent;
