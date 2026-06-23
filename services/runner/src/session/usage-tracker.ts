type UsageEventType = "step-finish" | "message.updated" | "message.completed";

type UsageSnapshot = {
  inputTokens: number;
  outputTokens: number;
  model?: string;
};

export type SessionUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  tokensUsed: number;
  model?: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const pickNumber = (
  record: Record<string, unknown>,
  keys: string[],
): number | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
};

const pickString = (
  record: Record<string, unknown>,
  keys: string[],
): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
};

export const extractUsageFromEvent = (
  eventType: string,
  props: Record<string, unknown>,
): UsageSnapshot | null => {
  if (
    eventType !== "step-finish" &&
    eventType !== "message.updated" &&
    eventType !== "message.completed"
  ) {
    return null;
  }

  const nestedUsage = asRecord(props.usage) ?? asRecord(props.tokens);

  const inputTokens =
    pickNumber(props, ["input_tokens", "inputTokens"]) ??
    pickNumber(nestedUsage ?? {}, ["input", "input_tokens", "inputTokens", "prompt_tokens"]) ??
    0;
  const outputTokens =
    pickNumber(props, ["output_tokens", "outputTokens"]) ??
    pickNumber(nestedUsage ?? {}, ["output", "output_tokens", "outputTokens", "completion_tokens"]) ??
    0;
  const model =
    pickString(props, ["model", "modelName"]) ??
    (nestedUsage ? pickString(nestedUsage, ["model", "modelName"]) : undefined);

  if (inputTokens <= 0 && outputTokens <= 0 && !model) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    ...(model ? { model } : {}),
  };
};

export const createSessionUsageTracker = () => {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let currentMessageInputSnapshot = 0;
  let currentMessageOutputSnapshot = 0;
  let sawStepUsage = false;
  let model: string | undefined;

  const setModel = (nextModel: string | undefined): void => {
    if (nextModel) {
      model = nextModel;
    }
  };

  const addUsage = (snapshot: UsageSnapshot): boolean => {
    totalInputTokens += snapshot.inputTokens;
    totalOutputTokens += snapshot.outputTokens;
    return snapshot.inputTokens > 0 || snapshot.outputTokens > 0;
  };

  const applyMessageSnapshot = (
    snapshot: UsageSnapshot,
    resetAfter: boolean,
  ): boolean => {
    const deltaInput = Math.max(0, snapshot.inputTokens - currentMessageInputSnapshot);
    const deltaOutput = Math.max(0, snapshot.outputTokens - currentMessageOutputSnapshot);

    totalInputTokens += deltaInput;
    totalOutputTokens += deltaOutput;

    if (resetAfter) {
      currentMessageInputSnapshot = 0;
      currentMessageOutputSnapshot = 0;
    } else {
      currentMessageInputSnapshot = Math.max(currentMessageInputSnapshot, snapshot.inputTokens);
      currentMessageOutputSnapshot = Math.max(currentMessageOutputSnapshot, snapshot.outputTokens);
    }

    return deltaInput > 0 || deltaOutput > 0;
  };

  const resetMessageSnapshots = (): void => {
    currentMessageInputSnapshot = 0;
    currentMessageOutputSnapshot = 0;
  };

  return {
    trackEvent(eventType: string, props: Record<string, unknown>): boolean {
      const snapshot = extractUsageFromEvent(eventType, props);

      if (!snapshot) {
        if (eventType === "message.completed") {
          resetMessageSnapshots();
        }
        return false;
      }

      setModel(snapshot.model);

      if (eventType === "step-finish") {
        sawStepUsage = true;
        resetMessageSnapshots();
        return addUsage(snapshot);
      }

      if (eventType === "message.updated" || eventType === "message.completed") {
        if (sawStepUsage) {
          if (eventType === "message.completed") {
            resetMessageSnapshots();
          }
          return false;
        }

        return applyMessageSnapshot(snapshot, eventType === "message.completed");
      }

      return false;
    },

    getSummary(): SessionUsageSummary {
      return {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        tokensUsed: totalInputTokens + totalOutputTokens,
        ...(model ? { model } : {}),
      };
    },
  };
};
