import { describe, expect, it, mock } from "bun:test";

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: () => undefined,
  }),
}));

mock.module("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: null,
      isPending: false,
      error: null,
    }),
    organization: {
      acceptInvitation: () => Promise.resolve({ error: null }),
    },
  },
}));

const { buildInvitationAuthRedirect } = await import("./use-accept-invitation");
describe("buildInvitationAuthRedirect", () => {
  it("sends invitation users to the credential onboarding flow", () => {
    expect(buildInvitationAuthRedirect("inv-1")).toBe(
      "/signup?invitation=1&redirectTo=%2Faccept-invitation%2Finv-1"
    );
  });
});
