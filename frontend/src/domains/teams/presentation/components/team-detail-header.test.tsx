import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

const baseProps = {
  name: "Platform Team",
  slug: "platform-team",
  memberCount: 3,
  canEditTeam: false,
  canDeleteTeam: false,
  onEdit: mock(() => {}),
  onDelete: mock(() => {}),
  onBack: mock(() => {}),
};

describe("TeamDetailHeader", () => {
  it("hides privileged team actions for plain members", async () => {
    const { TeamDetailHeader } = await import("./team-detail-header");

    render(<TeamDetailHeader {...baseProps} />);

    expect(
      screen.queryByRole("button", { name: "editTeam" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "deleteTeam" }),
    ).toBeNull();
  });

  it("shows edit for admins but reserves delete for owners", async () => {
    const { TeamDetailHeader } = await import("./team-detail-header");

    render(
      <TeamDetailHeader
        {...baseProps}
        canEditTeam
        canDeleteTeam={false}
      />,
    );

    expect(screen.getByRole("button", { name: "editTeam" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "deleteTeam" }),
    ).toBeNull();
  });
});
