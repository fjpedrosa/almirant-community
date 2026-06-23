"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExternalLink, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import type { OAuthConnectDialogProps } from "../../domain/types";

// ---------------------------------------------------------------------------
// OAuthConnectDialog - Purely presentational
// ---------------------------------------------------------------------------
// Dialog that guides the user through connecting an OAuth provider.
// Shows provider info, a "Connect with [Provider]" button, and visual
// feedback for each step of the OAuth flow.
// ---------------------------------------------------------------------------

export const OAuthConnectDialog: React.FC<OAuthConnectDialogProps> = ({
  open,
  onOpenChange,
  providerName,
  providerDescription,
  flowStep,
  error,
  onConnect,
  onCancel,
}) => {
  const isIdle = flowStep === "idle";
  const isInProgress =
    flowStep === "redirecting" || flowStep === "waiting_callback" || flowStep === "exchanging";
  const isSuccess = flowStep === "success";
  const isError = flowStep === "error";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {providerName}</DialogTitle>
          <DialogDescription>{providerDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Permissions overview */}
          {isIdle && (
            <div className="rounded-md border p-4 space-y-2">
              <p className="text-sm font-medium">
                This will allow Almirant to:
              </p>
              <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                <li>Read your account information</li>
                <li>Access resources based on the permissions you grant</li>
                <li>Perform actions on your behalf within the integration</li>
              </ul>
              <p className="text-xs text-muted-foreground pt-1">
                You can revoke access at any time from your {providerName}{" "}
                account settings.
              </p>
            </div>
          )}

          {/* Redirecting / waiting */}
          {(flowStep === "redirecting" || flowStep === "waiting_callback") && (
            <div className="flex items-center gap-3 rounded-md border p-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <div className="space-y-0.5">
                <p className="text-sm font-medium">
                  {flowStep === "redirecting"
                    ? `Opening ${providerName} authorization...`
                    : `Waiting for ${providerName} authorization...`}
                </p>
                <p className="text-xs text-muted-foreground">
                  Complete the authorization in the new tab that was opened.
                </p>
              </div>
            </div>
          )}

          {/* Exchanging tokens */}
          {flowStep === "exchanging" && (
            <div className="flex items-center gap-3 rounded-md border p-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <p className="text-sm font-medium">
                Completing connection...
              </p>
            </div>
          )}

          {/* Success */}
          {isSuccess && (
            <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
              <CheckCircle2 className="size-5 text-green-600 dark:text-green-400" />
              <p className="text-sm font-medium text-green-700 dark:text-green-300">
                Successfully connected to {providerName}!
              </p>
            </div>
          )}

          {/* Error */}
          {isError && error && (
            <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-4">
              <AlertCircle className="size-5 shrink-0 text-destructive mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">
                  Connection failed
                </p>
                <p className="text-xs text-muted-foreground">{error}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {isIdle && (
            <>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="button" onClick={onConnect}>
                <ExternalLink className="size-4" />
                Connect with {providerName}
              </Button>
            </>
          )}

          {isInProgress && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}

          {isSuccess && (
            <Button type="button" onClick={onCancel}>
              Done
            </Button>
          )}

          {isError && (
            <>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="button" onClick={onConnect}>
                Try Again
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
