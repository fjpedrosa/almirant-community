import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";

const handleConnect = mock(() => {});
const handleDisconnect = mock(() => {});
const syncInstallations = mock(() => Promise.resolve());

mock.module("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const labels: Record<string, string> = {
      "github.title": "GitHub Integration",
      "github.subtitle": "Connect repositories.",
      "github.connection": "GitHub Connection",
      "github.installations": "Installations",
      "github.linkedRepos": "Linked Repositories",
      "github.disconnect": "Disconnect",
      "github.addRepositories": "Add repositories",
      "github.manageInstallations": "Manage installations on GitHub",
      "github.appSetup.reconfigure": "Reconfigure GitHub App",
    };
    const fullKey = namespace ? `${namespace}.${key}` : key;
    return labels[fullKey] ?? key;
  },
}));

mock.module("@/components/icons/platform-provider-icon", () => ({
  PlatformProviderIcon: ({ provider }: { provider: string }) => (
    <span aria-hidden="true" data-provider={provider} />
  ),
}));

mock.module("../../application/hooks/use-github-status", () => ({
  useGithubStatus: () => ({
    isLoading: false,
    data: {
      configured: true,
      installations: [
        {
          id: "installation-1",
          installationId: 123,
          accountLogin: "acme-org",
          accountType: "organization",
          accountAvatarUrl: null,
          repositorySelection: "selected",
          suspendedAt: null,
          createdAt: "2026-04-26T00:00:00.000Z",
        },
      ],
      linkedRepos: [],
    },
  }),
}));

mock.module("../../application/hooks/use-github-connect", () => ({
  useGithubConnect: () => ({
    handleConnect,
    handleDisconnect,
    syncInstallations,
    isSyncing: false,
    githubAppSlug: "almirant-dev",
    githubInstallUrl:
      "https://github.com/apps/almirant-dev/installations/select_target",
  }),
}));

mock.module("@/domains/onboarding/application/hooks/use-github-app-setup", () => ({
  useGithubAppSetup: () => ({
    configured: true,
    isLoading: false,
    appSlug: "almirant-dev",
    activeTab: "manifest",
    setActiveTab: mock(() => {}),
    formValues: {
      appId: "",
      slug: "",
      clientId: "",
      clientSecret: "",
      webhookSecret: "",
      privateKeyPem: "",
    },
    handleFormValueChange: mock(() => {}),
    handleSaveManual: mock(() => {}),
    isSaving: false,
    handleManifestFlow: mock(() => {}),
    isCreatingApp: false,
    manifestForm: { appName: "", installTarget: "personal", orgSlug: "" },
    handleManifestFormChange: mock(() => {}),
    isManifestSubmittable: false,
    isTailscaleFunnel: false,
  }),
}));

describe("GithubSettingsContainer", () => {
  it("shows a direct action to add repositories to an existing GitHub App installation", async () => {
    const { GithubSettingsContainer } = await import("./github-settings-container");

    render(<GithubSettingsContainer />);

    const addRepositories = screen.getByRole("button", {
      name: "Add repositories",
    });

    fireEvent.click(addRepositories);

    expect(handleConnect).toHaveBeenCalledTimes(1);
  });
});
