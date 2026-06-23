import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

mock.module("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: null, isPending: false, error: null }),
    useActiveOrganization: () => ({ data: null, isPending: false }),
    useListOrganizations: () => ({ data: [], isPending: false }),
    organization: {
      setActive: () => Promise.resolve({ error: null }),
    },
  },
}));

mock.module("@/domains/api-keys/application/hooks/use-api-keys", () => ({
  useApiKeys: () => ({ data: [], isLoading: false }),
}));

mock.module("@/domains/api-keys/application/hooks/use-api-key-form", () => ({
  useApiKeyForm: () => ({
    form: {},
    dialogOpen: false,
    setDialogOpen: () => {},
    createdKey: null,
    createdDialogOpen: false,
    handleCreatedDialogClose: () => {},
    onSubmit: () => {},
    handleRevoke: () => {},
    isCreating: false,
    confirmDialogProps: {
      isOpen: false,
      options: {
        title: "",
        description: "",
        confirmLabel: "",
        cancelLabel: "",
      },
      handleConfirm: () => {},
      handleCancel: () => {},
    },
  }),
}));

mock.module(
  "@/domains/api-keys/application/hooks/use-service-account-key-form",
  () => ({
    useServiceAccountKeyForm: () => ({
      serviceAccounts: [],
      isLoading: false,
      rotatingId: null,
      rotateDialogOpen: false,
      newKey: null,
      copied: false,
      handleRotateKey: () => {},
      handleCopyKey: () => {},
      handleDialogClose: () => {},
    }),
  }),
);

mock.module(
  "@/domains/api-keys/presentation/components/service-account-keys",
  () => ({
    ServiceAccountKeys: () => <section>Service Account Keys</section>,
  }),
);

mock.module("@/domains/api-keys/presentation/components/api-key-list", () => ({
  ApiKeyList: () => <section>Personal API Keys</section>,
}));

mock.module(
  "@/domains/api-keys/presentation/components/create-api-key-dialog",
  () => ({
    CreateApiKeyDialog: () => null,
  }),
);

mock.module(
  "@/domains/api-keys/presentation/components/api-key-created-dialog",
  () => ({
    ApiKeyCreatedDialog: () => null,
  }),
);

mock.module(
  "@/domains/api-keys/presentation/components/rotate-key-dialog",
  () => ({
    RotateKeyDialog: () => null,
  }),
);

mock.module(
  "@/domains/shared/presentation/components/confirm-dialog",
  () => ({
    ConfirmDialog: () => null,
  }),
);

mock.module(
  "@/domains/settings/presentation/components/claude-code-setup",
  () => ({
    ClaudeCodeSetup: () => <section>Codex setup</section>,
  }),
);

const { ApiKeysPageContainer } = await import("./api-keys-page-container");

describe("ApiKeysPageContainer", () => {
  it("no muestra el setup de Codex/Claude Code en Settings > API Keys", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ApiKeysPageContainer />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "API Keys" })).toBeInTheDocument();
    expect(screen.getByText("Service Account Keys")).toBeInTheDocument();
    expect(screen.getByText("Personal API Keys")).toBeInTheDocument();
    expect(screen.queryByText("Codex setup")).toBeNull();
  });
});
