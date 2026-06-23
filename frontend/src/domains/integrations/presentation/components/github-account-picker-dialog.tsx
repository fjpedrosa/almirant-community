import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  Loader2,
  Plus,
  Github,
  AlertCircle,
  Building2,
  User,
  RefreshCw,
} from "lucide-react";
import type { GitHubAccountPickerDialogProps } from "../../domain/types";

// ---------------------------------------------------------------------------
// GitHubAccountPickerDialog - Purely presentational
// ---------------------------------------------------------------------------
// Dialog that displays a list of available GitHub App installations and lets
// the user connect one to their workspace. Already-connected accounts show a
// "Connected" badge and are disabled. A footer button allows installing the
// GitHub App on a new account/organization.
// ---------------------------------------------------------------------------

export const GitHubAccountPickerDialog: React.FC<
  GitHubAccountPickerDialogProps
> = ({
  open,
  onOpenChange,
  installations,
  isLoading,
  connectingId,
  onConnect,
  onInstallNew,
  canInstallNew,
  error,
  hasPersonalOAuth,
  onConnectPersonal,
  onReconnectPersonal,
  isConnectingPersonal,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="size-5" />
            Connect GitHub Account
          </DialogTitle>
          <DialogDescription>
            Select which GitHub account or organization to connect to this
            workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {/* Loading state */}
          {isLoading && (
            <div className="flex items-center justify-center gap-2 py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Loading GitHub installations...
              </p>
            </div>
          )}

          {/* Error state */}
          {!isLoading && error && (
            <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-4">
              <AlertCircle className="size-5 shrink-0 text-destructive mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">
                  Failed to load installations
                </p>
                <p className="text-xs text-muted-foreground">{error}</p>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && installations.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="rounded-full border p-3">
                <Github className="size-6 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  No GitHub App installations found
                </p>
                <p className="text-xs text-muted-foreground">
                  Install the GitHub App on your account or organization to get
                  started.
                </p>
              </div>
              {canInstallNew && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onInstallNew}
                >
                  <Plus className="size-4" />
                  Install GitHub App
                </Button>
              )}
            </div>
          )}

          {/* Installation list */}
          {!isLoading && !error && installations.length > 0 && (
            <ScrollArea className="max-h-[320px]">
              <div className="space-y-2">
                {installations.map((installation) => {
                  const accountLogin =
                    installation.accountLogin?.trim() || "Unknown account";
                  const accountType =
                    installation.accountType === "Organization"
                      ? "Organization"
                      : "Personal";
                  const isConnecting =
                    connectingId === installation.installationId;
                  const isDisabled =
                    installation.isConnected || connectingId !== null;

                  return (
                    <div
                      key={installation.installationId}
                      className="flex items-center gap-3 rounded-md border p-3"
                    >
                      <Avatar className="size-9">
                        <AvatarImage
                          src={installation.accountAvatarUrl ?? undefined}
                          alt={accountLogin}
                        />
                        <AvatarFallback>
                          {accountLogin.substring(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {accountLogin}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          {accountType === "Organization" ? (
                            <Building2 className="size-3" />
                          ) : (
                            <User className="size-3" />
                          )}
                          <span>{accountType}</span>
                        </div>
                      </div>

                      {installation.isConnected ? (
                        <Badge variant="secondary">Connected</Badge>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isDisabled}
                          onClick={() =>
                            onConnect(installation.installationId)
                          }
                        >
                          {isConnecting && (
                            <Loader2 className="size-3 animate-spin" />
                          )}
                          {isConnecting ? "Connecting..." : "Connect"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
          {/* Personal Account section */}
          {!isLoading && !error && (
            <>
              <div className="border-t pt-3 mt-1">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Personal Account (OAuth)
                </p>
                {hasPersonalOAuth ? (
                  <div className="flex items-center gap-3 rounded-md border p-3">
                    <div className="rounded-full border p-1.5">
                      <Github className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Personal GitHub</p>
                      <p className="text-xs text-muted-foreground">
                        Used for creating repos on your personal account
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isConnectingPersonal}
                      onClick={onReconnectPersonal}
                    >
                      {isConnectingPersonal ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3" />
                      )}
                      Reconnect
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-md border border-dashed p-3">
                    <div className="rounded-full border p-1.5">
                      <Github className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">Personal GitHub</p>
                      <p className="text-xs text-muted-foreground">
                        Connect to create repos on your personal account
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isConnectingPersonal}
                      onClick={onConnectPersonal}
                    >
                      {isConnectingPersonal && (
                        <Loader2 className="size-3 animate-spin" />
                      )}
                      Connect
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          {canInstallNew && installations.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={onInstallNew}
            >
              <Plus className="size-4" />
              Install on new account
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
