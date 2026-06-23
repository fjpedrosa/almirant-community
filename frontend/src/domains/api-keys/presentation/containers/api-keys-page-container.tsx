"use client";

import { useApiKeys } from "@/domains/api-keys/application/hooks/use-api-keys";
import { useApiKeyForm } from "@/domains/api-keys/application/hooks/use-api-key-form";
import { useServiceAccountKeyForm } from "@/domains/api-keys/application/hooks/use-service-account-key-form";
import { ApiKeyList } from "@/domains/api-keys/presentation/components/api-key-list";
import { CreateApiKeyDialog } from "@/domains/api-keys/presentation/components/create-api-key-dialog";
import { ApiKeyCreatedDialog } from "@/domains/api-keys/presentation/components/api-key-created-dialog";
import { ServiceAccountKeys } from "@/domains/api-keys/presentation/components/service-account-keys";
import { RotateKeyDialog } from "@/domains/api-keys/presentation/components/rotate-key-dialog";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { SettingsPageShell } from "@/domains/settings/presentation/components/settings-page-shell";

export const ApiKeysPageContainer: React.FC = () => {
  const { data: apiKeys, isLoading } = useApiKeys();
  const {
    form,
    dialogOpen,
    setDialogOpen,
    createdKey,
    createdDialogOpen,
    handleCreatedDialogClose,
    onSubmit,
    handleRevoke,
    isCreating,
    confirmDialogProps,
  } = useApiKeyForm();
  const {
    serviceAccounts,
    isLoading: isLoadingServiceAccounts,
    rotatingId,
    rotateDialogOpen,
    newKey,
    copied,
    handleRotateKey,
    handleCopyKey,
    handleDialogClose,
  } = useServiceAccountKeyForm();

  return (
    <SettingsPageShell
      title="API Keys"
      description="Manage API keys for external integrations and MCP access"
      actions={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New API Key
        </Button>
      }
    >
      <ServiceAccountKeys
        serviceAccounts={serviceAccounts}
        isLoading={isLoadingServiceAccounts}
        onRotateKey={handleRotateKey}
        rotatingId={rotatingId}
      />

      <ApiKeyList
        apiKeys={apiKeys ?? []}
        isLoading={isLoading}
        onRevoke={handleRevoke}
        onCreateClick={() => setDialogOpen(true)}
      />

      <CreateApiKeyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        form={form}
        isPending={isCreating}
        onSubmit={onSubmit}
      />

      <ApiKeyCreatedDialog
        open={createdDialogOpen}
        onOpenChange={handleCreatedDialogClose}
        createdKey={createdKey}
      />

      <RotateKeyDialog
        open={rotateDialogOpen}
        onOpenChange={handleDialogClose}
        newKey={newKey}
        onCopy={handleCopyKey}
        copied={copied}
      />

      <ConfirmDialog
        isOpen={confirmDialogProps.isOpen}
        options={confirmDialogProps.options}
        onConfirm={confirmDialogProps.handleConfirm}
        onCancel={confirmDialogProps.handleCancel}
      />
    </SettingsPageShell>
  );
};
