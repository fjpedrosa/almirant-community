import type { OpenCodeSessionRequestOptions } from "@almirant/remote-agent";

type PlanReviewSessionEvent = {
  event?: string;
  data: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const eventText = (event: PlanReviewSessionEvent): {
  type: string;
  props: Record<string, unknown>;
} => {
  let data: Record<string, unknown> = {};
  try {
    data = asRecord(JSON.parse(event.data));
  } catch {
    return { type: event.event ?? "", props: {} };
  }
  return {
    type: typeof data.type === "string" ? data.type : event.event ?? "",
    props: asRecord(data.properties ?? data),
  };
};

const textFromProps = (props: Record<string, unknown>): string => {
  const part = asRecord(props.part);
  const partType = typeof part.type === "string" ? part.type : props.type;
  if (partType !== undefined && partType !== "text") return "";
  for (const value of [props.content, props.text, props.delta, part.text]) {
    if (typeof value === "string") return value;
  }
  return "";
};

export type ExecutePlanReviewPromptInput = {
  sessionManager: {
    createSession: (options: { cwd: string }, requestOptions?: OpenCodeSessionRequestOptions) => Promise<{ id: string }>;
    sendPromptAsync: (
      sessionId: string,
      input: { prompt: string },
      requestOptions?: OpenCodeSessionRequestOptions,
    ) => Promise<void>;
    streamSessionEvents: (
      sessionId?: string,
      signal?: AbortSignal,
    ) => AsyncIterable<PlanReviewSessionEvent>;
  };
  prompt: string;
  requestOptions?: OpenCodeSessionRequestOptions;
  cwd?: string;
};

/** Execute one isolated OpenCode session and return only its assistant text. */
export const executePlanReviewPrompt = async ({
  sessionManager,
  prompt,
  requestOptions,
  cwd = "/workspace/repo",
}: ExecutePlanReviewPromptInput): Promise<string> => {
  const session = await sessionManager.createSession({ cwd }, requestOptions);
  const eventStream = sessionManager.streamSessionEvents(undefined, requestOptions?.signal);
  let text = "";
  let latestSnapshot = "";

  const consume = (async (): Promise<string> => {
    for await (const event of eventStream) {
      const { type, props } = eventText(event);
      const part = asRecord(props.part);
      if (type === "message.part.updated" && typeof part.text === "string") {
        latestSnapshot = part.text;
      } else if (type === "message.part.delta" || type === "agent.text") {
        text += textFromProps(props);
      }

      if (type === "session.error") {
        throw new Error("Plan review runtime session failed.");
      }
      if (type === "session.idle") {
        return text || latestSnapshot;
      }
      if (type === "session.closed") {
        const error = new Error("Plan review runtime process_lost before session idle.");
        Object.assign(error, { code: "process_lost" });
        throw error;
      }
    }
    const error = new Error("Plan review runtime process_lost before session idle.");
    Object.assign(error, { code: "process_lost" });
    throw error;
  })();

  await sessionManager.sendPromptAsync(
    session.id,
    { prompt },
    requestOptions,
  );
  return consume;
};
