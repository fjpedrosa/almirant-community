import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertCircle, ExternalLink, Key, Loader2, RefreshCw } from "lucide-react";
import type { ReconnectDialogProps } from "../../domain/types";

export const ReconnectDialog: React.FC<ReconnectDialogProps> = ({
  open,
  onOpenChange,
  connectionName,
  oauthState,
  isStartingOAuth,
  onStartOAuth,
  oauthCodeValue,
  onOAuthCodeChange,
  isSubmittingOAuthCode,
  onSubmitOAuthCode,
  setupTokenValue,
  onSetupTokenChange,
  isSubmittingSetupToken,
  onSubmitSetupToken,
  error,
}) => {
  const oauthStarted = !!oauthState;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            Reconnect
          </DialogTitle>
          <DialogDescription>
            Refresh credentials for{" "}
            <span className="font-medium">{connectionName}</span>. Settings,
            priority, and models will be preserved.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="oauth" className="mt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="oauth">OAuth</TabsTrigger>
            <TabsTrigger value="setup_token">Setup Token</TabsTrigger>
          </TabsList>

          <TabsContent value="oauth" className="space-y-4 pt-2">
            {!oauthStarted ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Opens claude.ai to authorize. You&apos;ll paste the code back
                  here.
                </p>
                <Button
                  onClick={onStartOAuth}
                  disabled={isStartingOAuth}
                  className="w-full"
                >
                  {isStartingOAuth ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ExternalLink className="mr-2 h-4 w-4" />
                  )}
                  Open Anthropic OAuth
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Paste the code from claude.ai below:
                </p>
                <Input
                  value={oauthCodeValue}
                  onChange={(e) => onOAuthCodeChange(e.target.value)}
                  placeholder="Paste authorization code..."
                  autoComplete="off"
                />
                <Button
                  onClick={onSubmitOAuthCode}
                  disabled={isSubmittingOAuthCode || !oauthCodeValue.trim()}
                  className="w-full"
                >
                  {isSubmittingOAuthCode ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Reconnect
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="setup_token" className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Paste a setup token from{" "}
              <code className="text-xs">claude setup-token</code>. This
              won&apos;t support automatic refresh.
            </p>
            <Input
              type="password"
              value={setupTokenValue}
              onChange={(e) => onSetupTokenChange(e.target.value)}
              placeholder="sk-ant-oat01-..."
              autoComplete="off"
            />
            <Button
              onClick={onSubmitSetupToken}
              disabled={isSubmittingSetupToken || !setupTokenValue.trim()}
              className="w-full"
              variant="outline"
            >
              {isSubmittingSetupToken ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Key className="mr-2 h-4 w-4" />
              )}
              Reconnect with Token
            </Button>
          </TabsContent>
        </Tabs>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
