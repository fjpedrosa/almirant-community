import { describe, expect, it } from "bun:test";
import {
  GITHUB_BOT_EMAIL,
  GITHUB_BOT_NAME,
  resolveDeliveryGitIdentity,
} from "./github-identity";

describe("resolveDeliveryGitIdentity", () => {
  it("resolves the standard bot identity for an ordinary job", () => {
    expect(resolveDeliveryGitIdentity({})).toEqual({
      trustedSiteBuild: false,
      runnerDeliveryEnabled: false,
      identity: { name: GITHUB_BOT_NAME, email: GITHUB_BOT_EMAIL },
    });
  });

  it("ignores agent-supplied identity fields on the job config", () => {
    expect(
      resolveDeliveryGitIdentity({
        gitAuthorName: "someone-else",
        gitAuthorEmail: "someone-else@example.com",
      }),
    ).toEqual({
      trustedSiteBuild: false,
      runnerDeliveryEnabled: false,
      identity: { name: GITHUB_BOT_NAME, email: GITHUB_BOT_EMAIL },
    });
  });
});
