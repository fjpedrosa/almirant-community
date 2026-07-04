import { beforeAll, describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { StepGithubCardProps } from "../../domain/types";

// Echo i18n keys so assertions can target them directly. Interpolation params
// (e.g. { slug }) are ignored — no test asserts on interpolated copy.
mock.module("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Radix primitives (Tabs / RadioGroup) used by the create flow rely on pointer
// + layout APIs that happy-dom does not implement. Shim them like the other
// Radix-rendering tests in this repo.
beforeAll(() => {
  globalThis.requestAnimationFrame ??= ((cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(0), 0)) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame ??= ((id: number) =>
    window.clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

const { StepGithubCard } = await import("./step-github-card");

const baseProps: StepGithubCardProps = {
  activeTab: "manifest",
  onTabChange: () => {},
  hasPublicUrl: true,
  isCreatingApp: false,
  onCreateViaManifest: () => {},
  manifestForm: { appName: "", installTarget: "personal", orgSlug: "" },
  onManifestFormChange: () => {},
  isManifestSubmittable: false,
  isTailscaleFunnel: false,
  formValues: {
    appId: "",
    slug: "",
    clientId: "",
    clientSecret: "",
    webhookSecret: "",
    privateKeyPem: "",
  },
  onFormValueChange: () => {},
  isSaving: false,
  onSaveManual: () => {},
  configured: false,
  appSlug: null,
  hasInstallations: false,
  githubInstallUrl: null,
  isSyncingInstallations: false,
  onInstallGithubApp: () => {},
  onSyncInstallations: () => {},
  onCreateProject: () => {},
  isSkipping: false,
  onSkip: () => {},
  done: false,
};

describe("StepGithubCard", () => {
  it("cloud (env App): done + resolved slug → renders the INSTALL block with an enabled install button", () => {
    render(
      <StepGithubCard
        {...baseProps}
        configured
        done
        appSlug="almirant-app"
        githubInstallUrl="https://github.com/apps/almirant-app/installations/select_target"
      />,
    );

    const installButton = screen.getByRole("button", { name: /installApp/ });
    expect(installButton).toBeInTheDocument();
    expect(installButton).not.toBeDisabled();
    // The create-flow tabs must NOT show once the App is installable.
    expect(screen.queryByText("tabManifest")).not.toBeInTheDocument();
  });

  it("self-hosted (not configured): renders the CREATE tabs, not the install button", () => {
    render(<StepGithubCard {...baseProps} configured={false} done={false} />);

    expect(screen.getByText("tabManifest")).toBeInTheDocument();
    expect(screen.getByText("tabManual")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /installApp/ }),
    ).not.toBeInTheDocument();
  });

  it("documents the pre-fix cloud dead-end: configured but done=false / empty slug → neither install nor create tabs", () => {
    // This is exactly the broken state the backend fix removes: the App is
    // configured via env (configured=true) but done=false and appSlug empty,
    // so the card shows only the header — no install button, no create tabs.
    render(
      <StepGithubCard
        {...baseProps}
        configured
        done={false}
        appSlug=""
        githubInstallUrl={null}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /installApp/ }),
    ).not.toBeInTheDocument();
    // configured=true hides the create tabs too → dead end.
    expect(screen.queryByText("tabManifest")).not.toBeInTheDocument();
  });
});
