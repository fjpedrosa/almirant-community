import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { TeamMemberListProps } from "../../domain/types";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

const defaultProps: TeamMemberListProps = {
  members: [
    {
      id: "member-1",
      organizationId: "org-1",
      userId: "user-2",
      role: "member",
      createdAt: new Date("2026-04-10T10:00:00.000Z"),
      user: {
        id: "user-2",
        email: "member@example.com",
        name: "Member User",
        image: null,
      },
    },
  ],
  invitations: [
    {
      id: "inv-1",
      organizationId: "org-1",
      email: "invitee@example.com",
      role: "member",
      status: "pending",
      inviterId: "user-1",
      expiresAt: new Date("2026-04-20T10:00:00.000Z"),
      createdAt: new Date("2026-04-10T10:00:00.000Z"),
    },
  ],
  currentUserId: "user-1",
  isLoading: false,
  canInviteMembers: false,
  canManageMembers: false,
  canManageInvitations: false,
  onInvite: mock(() => {}),
  onRemoveMember: mock(() => {}),
  onUpdateRole: mock(() => {}),
  onCancelInvitation: mock(() => {}),
  onResendInvitation: mock(() => {}),
};

describe("TeamMemberList", () => {
  it("does not render management affordances for plain members", async () => {
    const { TeamMemberList } = await import("./team-member-list");

    render(<TeamMemberList {...defaultProps} />);

    expect(
      screen.queryByRole("button", { name: "inviteMember" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "actions" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "resendInvitation" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "cancelInvitation" }),
    ).toBeNull();
  });

  it("renders management affordances for admins and owners", async () => {
    const { TeamMemberList } = await import("./team-member-list");

    render(
      <TeamMemberList
        {...defaultProps}
        canInviteMembers
        canManageMembers
        canManageInvitations
      />,
    );

    expect(
      screen.getByRole("button", { name: "inviteMember" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "actions" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "resendInvitation" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "cancelInvitation" }),
    ).toBeInTheDocument();
  });
});
