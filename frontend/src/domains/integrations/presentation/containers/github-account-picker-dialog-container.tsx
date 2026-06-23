"use client";

import type { useGitHubAccountPicker } from "../../application/hooks/use-github-account-picker";
import { GitHubAccountPickerDialog } from "../components/github-account-picker-dialog";

// ---------------------------------------------------------------------------
// GitHubAccountPickerDialogContainer
// ---------------------------------------------------------------------------
// Wires the useGitHubAccountPicker hook to the presentational dialog.
// The hook instance is created in the parent page and passed as a prop so
// the parent can programmatically open the dialog when the user clicks
// "Connect" on the GitHub provider card.
//
// Usage from parent:
//   const accountPicker = useGitHubAccountPicker();
//   // on provider card click:
//   accountPicker.openDialog();
//   // render:
//   <GitHubAccountPickerDialogContainer accountPicker={accountPicker} />
// ---------------------------------------------------------------------------

interface GitHubAccountPickerDialogContainerProps {
  accountPicker: ReturnType<typeof useGitHubAccountPicker>;
}

export const GitHubAccountPickerDialogContainer: React.FC<
  GitHubAccountPickerDialogContainerProps
> = ({ accountPicker }) => {
  return (
    <GitHubAccountPickerDialog
      open={accountPicker.dialogOpen}
      onOpenChange={(open) => {
        if (!open) accountPicker.closeDialog();
      }}
      installations={accountPicker.installations}
      isLoading={accountPicker.isLoading}
      connectingId={accountPicker.connectingId}
      onConnect={accountPicker.handleConnect}
      onInstallNew={accountPicker.handleInstallNew}
      canInstallNew={accountPicker.canInstallNew}
      error={accountPicker.error}
      hasPersonalOAuth={accountPicker.hasPersonalOAuth}
      onConnectPersonal={accountPicker.connectPersonalAccount}
      onReconnectPersonal={accountPicker.connectPersonalAccount}
      isConnectingPersonal={accountPicker.isConnectingPersonal}
    />
  );
};

// Re-export hook for convenience so parent pages only need one import
export { useGitHubAccountPicker } from "../../application/hooks/use-github-account-picker";
