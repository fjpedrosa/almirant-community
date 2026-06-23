type InjectableMemoryItem = {
  id: string;
  title: string;
  content: string;
  topicKey: string;
  type: string;
  score: number;
  confidence: number;
};

type InjectOptions = {
  model?: string | null;
  tokenizer?: (text: string, model?: string | null) => number;
  budgetTokens: number;
};

const defaultTokenEstimate = (text: string, model?: string | null) => {
  const divisor = model?.includes("claude") ? 3.6 : 4;
  return Math.ceil(text.length / divisor);
};

export const injectIntoPrompt = (
  items: InjectableMemoryItem[],
  options: InjectOptions
) => {
  const estimate =
    options.tokenizer ??
    ((text: string, model?: string | null) => defaultTokenEstimate(text, model));

  const injected: InjectableMemoryItem[] = [];
  let usedTokens = 0;

  for (const item of items) {
    const block = `- [${item.type}] ${item.title} (${item.topicKey})\n  Score: ${item.score.toFixed(
      3
    )} · Confidence: ${item.confidence.toFixed(2)}\n  ${item.content}`;
    const blockTokens = estimate(block, options.model);
    if (usedTokens + blockTokens > options.budgetTokens) break;
    injected.push(item);
    usedTokens += blockTokens;
  }

  const text =
    injected.length === 0
      ? ""
      : `## Prior learnings\n${injected
          .map(
            (item) =>
              `- [${item.type}] ${item.title} (${item.topicKey})\n  ${item.content}`
          )
          .join("\n")}`;

  return {
    text,
    usedTokens,
    injectedIds: injected.map((item) => item.id),
    dropped: Math.max(0, items.length - injected.length),
  };
};
