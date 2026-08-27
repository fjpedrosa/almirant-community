import { afterAll, describe, expect, it } from "bun:test";

const previousApiUrl = process.env.NEXT_PUBLIC_API_URL;
process.env.NEXT_PUBLIC_API_URL = "http://localhost:3000/api";

const { buildCreateConnectionInput } = await import("./use-api-key-connect-form");

afterAll(() => {
  if (previousApiUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = previousApiUrl;
  }
});

describe("buildCreateConnectionInput", () => {
  it("keeps secret-bearing credentials isolated from connection metadata", () => {
    const apiKey = "sensitive-api-key-canary";
    const credentials = { apiKey };
    const config = { planningModel: "gpt-5.4" };

    const input = buildCreateConnectionInput({
      provider: "openai",
      scope: "user",
      name: "OpenAI test connection",
      credentials,
      config,
    });

    const { credentials: submittedCredentials, ...metadata } = input;

    expect(submittedCredentials).toBe(credentials);
    expect(
      Object.prototype.hasOwnProperty.call(input, "accountIdentifier"),
    ).toBe(false);
    expect(metadata).toEqual({
      provider: "openai",
      category: "ai",
      scope: "user",
      name: "OpenAI test connection",
      config,
    });
    expect(JSON.stringify(metadata)).not.toContain(apiKey);
    expect(JSON.stringify(metadata)).not.toContain(apiKey.slice(0, 7));
  });
});
