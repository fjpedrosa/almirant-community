import { describe, expect, it } from "bun:test";

describe("team member query key contract", () => {
  it("keeps the Better-Auth member payload separate from team detail", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:3001/api";
    const { teamKeys } = await import("./use-teams");
    const { teamMembersQueryKey } = await import("./use-team-members-select");
    const membersKey = teamMembersQueryKey("org-1");

    expect(membersKey).toEqual(teamKeys.members("org-1"));
    expect(membersKey).not.toEqual(teamKeys.detail("org-1"));
  });

  it("uses a stable disabled key while no active team exists", async () => {
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:3001/api";
    const { teamKeys } = await import("./use-teams");
    const { teamMembersQueryKey } = await import("./use-team-members-select");
    expect(teamMembersQueryKey(null)).toEqual(teamKeys.members("members-select"));
  });
});
