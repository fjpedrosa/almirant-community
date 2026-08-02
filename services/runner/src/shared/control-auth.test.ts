import { describe, expect, it } from "bun:test";
import { isAuthorizedRunnerControlRequest } from "./control-auth";

describe("runner control endpoint authentication", () => {
  it("requires the exact server-owned bearer token", () => {
    expect(isAuthorizedRunnerControlRequest(
      new Request("http://runner:3002/drain", { headers: { authorization: "Bearer control-secret" } }),
      "control-secret",
    )).toBe(true);
    expect(isAuthorizedRunnerControlRequest(new Request("http://runner:3002/drain"), "control-secret")).toBe(false);
    expect(isAuthorizedRunnerControlRequest(
      new Request("http://runner:3002/drain", { headers: { authorization: "Bearer wrong" } }),
      "control-secret",
    )).toBe(false);
    expect(isAuthorizedRunnerControlRequest(new Request("http://runner:3002/drain"), undefined)).toBe(false);
  });
});
