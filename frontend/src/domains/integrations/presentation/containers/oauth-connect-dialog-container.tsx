"use client";

import { useOAuthConnect } from "../../application/hooks/use-oauth-connect";
import { OAuthConnectDialog } from "../components/oauth-connect-dialog";

// ---------------------------------------------------------------------------
// OAuthConnectDialogContainer
// ---------------------------------------------------------------------------
// Wires the useOAuthConnect hook to the presentational OAuthConnectDialog.
// Exposes an `openDialog(provider)` handle via ref or callback so the parent
// page can trigger the dialog programmatically when the user clicks "Connect"
// on an OAuth provider card.
//
// Usage from parent:
//   const oauthConnect = useOAuthConnect();
//   // on provider card click:
//   oauthConnect.openDialog("github");
//   // render:
//   <OAuthConnectDialogContainer oauthConnect={oauthConnect} />
// ---------------------------------------------------------------------------

interface OAuthConnectDialogContainerProps {
  oauthConnect: ReturnType<typeof useOAuthConnect>;
}

export const OAuthConnectDialogContainer: React.FC<
  OAuthConnectDialogContainerProps
> = ({ oauthConnect }) => {
  const {
    dialogOpen,
    activeProvider,
    providerName,
    providerDescription,
    flowStep,
    error,
    closeDialog,
    handleConnect,
  } = oauthConnect;

  if (!activeProvider) return null;

  return (
    <OAuthConnectDialog
      open={dialogOpen}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
      provider={activeProvider}
      providerName={providerName}
      providerDescription={providerDescription}
      flowStep={flowStep}
      error={error}
      onConnect={handleConnect}
      onCancel={closeDialog}
    />
  );
};

// Re-export hook for convenience so parent pages only need one import
export { useOAuthConnect } from "../../application/hooks/use-oauth-connect";
