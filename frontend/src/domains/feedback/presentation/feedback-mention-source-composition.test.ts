import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const files = (relativePath: string) =>
  readFileSync(resolve(import.meta.dir, relativePath), "utf8");

describe("feedback mention-member source composition", () => {
  it("threads the optional source from page to detail, comments, and hook", () => {
    const page = files("containers/feedback-page-container.tsx");
    const detail = files("components/feedback-detail-panel.tsx");
    const comments = files("containers/feedback-comments-section-container.tsx");

    expect(page).toContain("mentionMemberSource?: FeedbackMentionMemberSource");
    expect(page).toContain("mentionMemberSource={mentionMemberSource}");
    expect(detail).toContain("mentionMemberSource?: FeedbackMentionMemberSource");
    expect(detail).toContain("mentionMemberSource={mentionMemberSource}");
    expect(comments).toContain("mentionMemberSource?: FeedbackMentionMemberSource");
    expect(comments).toContain("useFeedbackMentionMembers(mentionMemberSource)");
  });
});
