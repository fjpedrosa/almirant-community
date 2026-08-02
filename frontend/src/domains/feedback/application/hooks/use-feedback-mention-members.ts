"use client";

import { useQuery } from "@tanstack/react-query";
import { usersApi } from "@/lib/api/client";
import type { MentionMember } from "@/domains/shared/domain/types";
import { feedbackKeys } from "./use-feedback-traceability";

/**
 * Returns active-org members with an elevated workspace role (admin/owner)
 * as MentionMember[].
 *
 * Cloud's version intersects this with the GLOBAL instance-admin role
 * (`user.role === "admin"`, gating access to the cross-tenant `/backoffice`
 * SaaS surface) because that surface — and the notification it triggers —
 * is unreachable by anyone else. Community has no such cross-tenant
 * surface: the feedback-triage domain this powers is reachable by any
 * instance admin from within their own workspace, and workspace
 * membership already scopes notification delivery (persisted with
 * `activeOrganizationId`; the feed filters by (userId, activeOrganizationId)).
 * Filtering to elevated workspace roles (admin/owner) is therefore the
 * direct community equivalent, without depending on a global cross-tenant
 * user directory this build does not have.
 */
export const useFeedbackMentionMembers = () => {
  const membersQuery = useQuery({
    queryKey: [...feedbackKeys.mentionMembers(), "active-org-members"],
    queryFn: () => usersApi.listMembers(),
    staleTime: 5 * 60 * 1000,
  });

  const mentionMembers: MentionMember[] = (() => {
    const members = membersQuery.data ?? [];
    return members
      .filter((m) => m.role === "admin" || m.role === "owner")
      .map((m) => ({ id: m.userId, name: m.name, email: m.email, image: m.image }));
  })();

  return {
    mentionMembers,
    isLoading: membersQuery.isLoading,
  };
};
