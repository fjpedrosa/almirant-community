"use client";

import { ApiKeyConnectDialog } from "../components/api-key-connect-dialog";
import type { UseApiKeyConnectFormReturn } from "../../domain/types";

// ---------------------------------------------------------------------------
// ApiKeyConnectDialogContainer
// ---------------------------------------------------------------------------
// Wires a pre-created useApiKeyConnectForm instance to the presentational
// dialog. The parent page controls scope/provider before opening.
// ---------------------------------------------------------------------------

interface ApiKeyConnectDialogContainerProps {
  apiKeyForm?: UseApiKeyConnectFormReturn;
  onSubscriptionClick?: () => void;
}

export const ApiKeyConnectDialogContainer: React.FC<
  ApiKeyConnectDialogContainerProps
> = ({ apiKeyForm: externalForm, onSubscriptionClick }) => {
  if (!externalForm) {
    return null;
  }

  const {
    form,
    dialogOpen,
    setDialogOpen,
    onSubmit,
    isSubmitting,
    isFormValid,
    selectedProvider,
    isTesting,
    testError,
    isEditing,
    providerLocked,
  } = externalForm;

  return (
    <ApiKeyConnectDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      form={form}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
      isFormValid={isFormValid}
      selectedProvider={selectedProvider}
      isTesting={isTesting}
      testError={testError}
      isEditing={isEditing}
      providerLocked={providerLocked}
      availableModels={externalForm.availableModels}
      showSubscriptionOption={
        selectedProvider === "anthropic" || selectedProvider === "openai"
      }
      onSubscriptionClick={onSubscriptionClick}
    />
  );
};
