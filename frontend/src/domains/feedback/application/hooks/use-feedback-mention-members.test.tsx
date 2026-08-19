import React from "react";
import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActiveOrgProvider } from "@/domains/teams/application/active-org-context";
import type { FeedbackMentionMemberCandidate, FeedbackMentionMemberSource } from "../mention-member-source";

let activeWorkspace = "workspace-a";
const candidate = (userId: string, role: string): FeedbackMentionMemberCandidate => ({
  userId,
  role,
  name: `${userId} Name`,
  email: `${userId}@example.test`,
  image: `${userId}.png`,
});
const workspaceCandidates: Record<string, FeedbackMentionMemberCandidate[]> = {
  "workspace-a": [candidate("admin-a", "admin"), candidate("member-a", "member")],
  "workspace-b": [candidate("owner-b", "owner")],
};
const listMembers = mock(async () => workspaceCandidates[activeWorkspace] ?? []);

mock.module("@/lib/auth-client", () => ({
  authClient: {
    useActiveOrganization: () => ({ data: { id: activeWorkspace }, isPending: false }),
    organization: { setActive: async () => ({ error: null }) },
  },
}));
mock.module("@/lib/api/client", () => ({ usersApi: { listMembers }, adminFeedbackApi: {} }));

afterAll(() => mock.restore());
afterEach(() => listMembers.mockClear());

const harness = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ActiveOrgProvider initialActiveOrgId={activeWorkspace}>{children}</ActiveOrgProvider>
    </QueryClientProvider>
  );
  return { client, wrapper };
};

describe("useFeedbackMentionMembers", () => {
  it("preserves the default key, stale time, loading, mapping, and roles", async () => {
    const { useFeedbackMentionMembers } = await import("./use-feedback-mention-members");
    const { client, wrapper } = harness();
    const { result } = renderHook(() => useFeedbackMentionMembers(), { wrapper });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.mentionMembers).toEqual([
      { id: "admin-a", name: "admin-a Name", email: "admin-a@example.test", image: "admin-a.png" },
    ]);
    const query = client.getQueryCache().getAll()[0]!;
    expect(query.queryKey).toEqual(["backoffice", "feedback", "mention-members", "active-org-members"]);
    expect((query.options as { staleTime?: number }).staleTime).toBe(5 * 60 * 1000);
  });

  it("uses an injected async source, isolates its cache identity, and rejects out-of-scope ids", async () => {
    const { useFeedbackMentionMembers } = await import("./use-feedback-mention-members");
    const { client, wrapper } = harness();
    let received: readonly FeedbackMentionMemberCandidate[] = [];
    const source: FeedbackMentionMemberSource = {
      cacheKey: "narrow-directory",
      resolve: async (candidates) => {
        received = candidates;
        return [...candidates]
          .filter((item) => item.userId === "member-a" || item.userId === "owner-b")
          .map(({ userId }) => ({ id: userId, name: "Scoped", email: "scoped@example.test", image: null }))
          .concat({ id: "outside", name: "Outside", email: "outside@example.test", image: null });
      },
    };

    const { result, rerender } = renderHook(() => useFeedbackMentionMembers(source), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(received).toEqual(workspaceCandidates["workspace-a"]);
    expect(result.current.mentionMembers).toEqual([
      { id: "member-a", name: "Scoped", email: "scoped@example.test", image: null },
    ]);
    expect(client.getQueryCache().getAll()[0]?.queryKey).toEqual([
      "backoffice", "feedback", "mention-members", "active-org-members", "source", "narrow-directory", "org:workspace-a",
    ]);

    activeWorkspace = "workspace-b";
    rerender();
    await waitFor(() => expect(result.current.mentionMembers[0]?.id).toBe("owner-b"));
    expect(result.current.mentionMembers).toEqual([
      { id: "owner-b", name: "Scoped", email: "scoped@example.test", image: null },
    ]);
    expect(listMembers).toHaveBeenCalledTimes(2);
    activeWorkspace = "workspace-a";
  });
});
