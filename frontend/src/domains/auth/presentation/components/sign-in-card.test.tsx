import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SignInCardProps } from "../../domain/types";

/**
 * Gating tests for the social sign-in buttons on `SignInCard`.
 *
 * `next-intl`'s `useTranslations` needs a provider; we mock it to echo keys.
 * mock.module is PROCESS-GLOBAL so we capture the real module and restore it in
 * afterAll to avoid leaking into other test files.
 */
let realNextIntl: unknown = {};
try {
  realNextIntl = await import("next-intl");
} catch {
  realNextIntl = {};
}

mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

afterAll(() => {
  mock.module("next-intl", () => realNextIntl);
});

afterEach(() => cleanup());

const baseProps: SignInCardProps = {
  mode: "sign_in",
  values: { name: "", email: "", password: "", confirmPassword: "" },
  onValueChange: () => {},
  onSubmit: () => {},
  isLoading: false,
  error: null,
};

const renderCard = async (overrides: Partial<SignInCardProps>) => {
  const { SignInCard } = await import("./sign-in-card");
  return render(<SignInCard {...baseProps} {...overrides} />);
};

describe("SignInCard social providers", () => {
  it("renders the Google button and divider when google is enabled", async () => {
    await renderCard({ socialProviders: { google: true } });

    expect(
      screen.getByRole("button", { name: "continueWithGoogle" }),
    ).toBeInTheDocument();
    expect(screen.getByText("orContinueWith")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "continueWithGithub" }),
    ).toBeNull();
  });

  it("renders both buttons when google and github are enabled", async () => {
    await renderCard({ socialProviders: { google: true, github: true } });

    expect(
      screen.getByRole("button", { name: "continueWithGoogle" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "continueWithGithub" }),
    ).toBeInTheDocument();
  });

  it("renders no social buttons when no provider is enabled", async () => {
    await renderCard({ socialProviders: { google: false, github: false } });

    expect(
      screen.queryByRole("button", { name: "continueWithGoogle" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "continueWithGithub" }),
    ).toBeNull();
    expect(screen.queryByText("orContinueWith")).toBeNull();
  });

  it("renders no social buttons when socialProviders is omitted", async () => {
    await renderCard({});

    expect(
      screen.queryByRole("button", { name: "continueWithGoogle" }),
    ).toBeNull();
    expect(screen.queryByText("orContinueWith")).toBeNull();
  });

  it("never renders social buttons in initial_admin_setup mode", async () => {
    await renderCard({
      mode: "initial_admin_setup",
      socialProviders: { google: true, github: true },
    });

    expect(
      screen.queryByRole("button", { name: "continueWithGoogle" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "continueWithGithub" }),
    ).toBeNull();
  });

  it("invokes onSocialSignIn with the provider when a button is clicked", async () => {
    const onSocialSignIn = mock((provider: "google" | "github") => provider);
    await renderCard({
      socialProviders: { github: true },
      onSocialSignIn,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "continueWithGithub" }),
    );

    expect(onSocialSignIn).toHaveBeenCalledWith("github");
  });

  it("disables the social buttons while loading", async () => {
    await renderCard({ socialProviders: { google: true }, isLoading: true });

    expect(
      (screen.getByRole("button", {
        name: "continueWithGoogle",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
