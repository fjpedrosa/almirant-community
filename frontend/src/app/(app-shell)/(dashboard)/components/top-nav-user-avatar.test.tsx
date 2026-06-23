import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

mock.module("@/domains/auth/application/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "admin-user",
      name: "Admin User",
      email: "admin@example.com",
      image: null,
      role: "admin",
    },
    signOut: mock(() => {}),
  }),
}));

mock.module("@/domains/shared/application/hooks/use-posthog-feature-flag", () => ({
  usePostHogFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

afterEach(() => cleanup());

const openProfileMenu = async () => {
  const trigger = screen.getByRole("button", { name: "Open profile menu" });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "signOut" })).toBeTruthy());
};

describe("TopNavUserAvatar", () => {
  it("does not expose the internal backoffice link in the community app", async () => {
    const { TopNavUserAvatar } = await import("./top-nav-user-avatar");

    render(<TopNavUserAvatar />);

    await openProfileMenu();

    expect(screen.queryByText("backoffice")).toBeNull();
    expect(screen.queryByRole("link", { name: /backoffice/i })).toBeNull();
  });

  it("shows handbook as the first navigation item", async () => {
    const { TopNavUserAvatar } = await import("./top-nav-user-avatar");

    render(<TopNavUserAvatar />);

    await openProfileMenu();

    const handbookText = await screen.findByText("handbook");
    const handbookItem = handbookText.closest("a");
    expect(handbookItem?.getAttribute("href")).toBe("/handbook");

    const menu = handbookItem?.closest('[role="menu"]');
    const menuItems = Array.from(menu?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []);
    const handbookIndex = menuItems.findIndex((item) => item.getAttribute("href") === "/handbook");
    const teamsIndex = menuItems.findIndex((item) => item.getAttribute("href") === "/teams");
    const projectsIndex = menuItems.findIndex((item) => item.getAttribute("href") === "/projects");

    expect(handbookIndex).toBeGreaterThanOrEqual(0);
    expect(teamsIndex).toBeGreaterThan(handbookIndex);
    expect(projectsIndex).toBeGreaterThan(handbookIndex);
  });
});
