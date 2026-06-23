export type WaveAgentDescriptor = {
  agent: string;
  taskId: string;
  title: string;
};

export type RawOutputEvent = {
  type: "raw";
  line: string;
  contentType?: "thinking" | "text" | "tool_use";
};

export type StepOutputEvent = {
  type: "step";
  description: string;
};

export type DoneOutputEvent = {
  type: "done";
  summary: string;
};

export type ErrorOutputEvent = {
  type: "error";
  reason: string;
};

export type WarnOutputEvent = {
  type: "warn";
  reason: string;
};

export type WaveStartOutputEvent = {
  type: "wave_start";
  agents: WaveAgentDescriptor[];
  raw: string;
};

export type AgentDoneOutputEvent = {
  type: "agent_done";
  agent: string;
  taskId: string;
  status: "SUCCESS" | "FAILED";
  reason?: string;
};

export type WaveEndOutputEvent = {
  type: "wave_end";
  successCount: number;
  totalCount: number;
  raw: string;
};

export type QuestionOutputEvent = {
  type: "question";
  text: string;
};

export type OptionsOutputEvent = {
  type: "options";
  options: string[];
};

export type WaitingOutputEvent = {
  type: "waiting";
  text: string;
};

export type ResponseCompleteOutputEvent = {
  type: "response_complete";
  summary: string;
};

export type OutputEvent =
  | RawOutputEvent
  | StepOutputEvent
  | DoneOutputEvent
  | ErrorOutputEvent
  | WarnOutputEvent
  | WaveStartOutputEvent
  | AgentDoneOutputEvent
  | WaveEndOutputEvent
  | QuestionOutputEvent
  | OptionsOutputEvent
  | WaitingOutputEvent
  | ResponseCompleteOutputEvent;
