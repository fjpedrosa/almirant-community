import { describe, expect, it } from "bun:test";
import {
  defaultFeedbackMentionMemberSource,
  type FeedbackMentionMemberCandidate,
} from "./mention-member-source";

const candidate = (role: string, userId = `${role}-1`): FeedbackMentionMemberCandidate => ({
  userId,
  name: `${role} Name`,
  email: `${role}@example.test`,
  image: `${role}.png`,
  role,
});

describe("default feedback mention-member source", () => {
  it("keeps owner/admin, maps fields, and excludes ordinary members", async () => {
    expect(
      defaultFeedbackMentionMemberSource.resolve([
        candidate("owner"),
        candidate("admin"),
        candidate("member"),
      ]),
    ).toEqual([
      { id: "owner-1", name: "owner Name", email: "owner@example.test", image: "owner.png" },
      { id: "admin-1", name: "admin Name", email: "admin@example.test", image: "admin.png" },
    ]);
  });

  it("returns an empty list for an empty candidate set", async () => {
    expect(defaultFeedbackMentionMemberSource.resolve([])).toEqual([]);
  });
});
