import { describe, expect, it } from "bun:test";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";

import { createModel } from "./model-factory";

const ZAI_CODING_PLAN_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const ZAI_ANTHROPIC_BASE_URL = "https://api.z.ai/api/anthropic";

const clientBaseUrl = (model: unknown): string | undefined =>
  (model as { clientOptions?: { baseURL?: string } }).clientOptions?.baseURL;

describe("createModel — Z.AI Coding Plan", () => {
  // A Coding Plan token authenticates against Z.AI's Anthropic-compatible
  // surface — the same one the runner injects as ANTHROPIC_BASE_URL /
  // ANTHROPIC_AUTH_TOKEN for Claude Code. The OpenAI-compatible
  // `coding/paas/v4` surface rejects those tokens with
  // `401 token expired or incorrect`, which is what every server-side Z.AI
  // call hit before this.
  it("talks Anthropic, not OpenAI, when the connection is a Coding Plan", () => {
    const model = createModel({
      provider: "zai",
      apiKey: "zai-coding-plan-token",
      modelName: "glm-4.6",
      baseUrl: ZAI_CODING_PLAN_BASE_URL,
    });

    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(clientBaseUrl(model)).toBe(ZAI_ANTHROPIC_BASE_URL);
  });

  it("defaults to the Coding Plan when the connection carries no baseUrl", () => {
    const model = createModel({
      provider: "zai",
      apiKey: "zai-coding-plan-token",
      modelName: "glm-5.2",
    });

    expect(model).toBeInstanceOf(ChatAnthropic);
    expect(clientBaseUrl(model)).toBe(ZAI_ANTHROPIC_BASE_URL);
  });

  it("sends the token as an auth token, never as an Anthropic API key", () => {
    // Z.AI expects `Authorization: Bearer <token>`; passing the value as
    // anthropicApiKey would send it in `x-api-key` instead and fail auth.
    const model = createModel({
      provider: "zai",
      apiKey: "zai-coding-plan-token",
      modelName: "glm-4.6",
      baseUrl: ZAI_CODING_PLAN_BASE_URL,
    });

    const options = (model as { clientOptions?: { authToken?: string } })
      .clientOptions;
    expect(options?.authToken).toBe("zai-coding-plan-token");
  });

  it("keeps the OpenAI-compatible client for a non-Coding-Plan endpoint", () => {
    // Platform (pay-as-you-go) API keys still use the OpenAI-compatible
    // surface, so an explicit non-Coding-Plan baseUrl must not be rerouted.
    const model = createModel({
      provider: "zai",
      apiKey: "zai-platform-api-key",
      modelName: "glm-4.6",
      baseUrl: "https://api.z.ai/api/paas/v4",
    });

    expect(model).toBeInstanceOf(ChatOpenAI);
  });
});
