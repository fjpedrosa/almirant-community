import type { MentionMember } from "@/domains/shared/domain/types";

export interface FeedbackMentionMemberCandidate {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
}

export interface FeedbackMentionMemberSource {
  cacheKey: string;
  resolve: (
    candidates: readonly FeedbackMentionMemberCandidate[],
  ) => MentionMember[] | Promise<MentionMember[]>;
}

export const defaultFeedbackMentionMemberSource: FeedbackMentionMemberSource = {
  cacheKey: "default-admin-owner",
  resolve: (candidates) =>
    candidates
      .filter((candidate) => candidate.role === "admin" || candidate.role === "owner")
      .map(({ userId, name, email, image }) => ({ id: userId, name, email, image })),
};
