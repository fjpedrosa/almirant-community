"use client";

import { useQuery } from "@tanstack/react-query";
import { usersApi } from "@/lib/api/client";
import { useOrgScopedKey } from "@/lib/query-keys";
import {
  defaultFeedbackMentionMemberSource,
  type FeedbackMentionMemberSource,
} from "../mention-member-source";

export const useFeedbackMentionMembers = (source?: FeedbackMentionMemberSource) => {
  const activeSource = source ?? defaultFeedbackMentionMemberSource;
  const baseKey = [
    "backoffice",
    "feedback",
    "mention-members",
    "active-org-members",
    ...(source ? ["source", source.cacheKey] : []),
  ] as const;
  const scopedKey = useOrgScopedKey(baseKey);
  const membersQuery = useQuery({
    queryKey: source ? scopedKey : baseKey,
    queryFn: async () => {
      const candidates = await usersApi.listMembers();
      const mentionMembers = await activeSource.resolve(candidates);
      const candidateIds = new Set(candidates.map((candidate) => candidate.userId));
      return mentionMembers.filter((member) => candidateIds.has(member.id));
    },
    staleTime: 5 * 60 * 1000,
  });

  return {
    mentionMembers: membersQuery.data ?? [],
    isLoading: membersQuery.isLoading,
  };
};
