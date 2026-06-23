import { MessageSquare, CheckCircle2, XCircle, Loader2, Unplug } from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { DiscordConnectionCardProps } from "../../domain/types";

// ---------------------------------------------------------------------------
// DiscordConnectionCard - Presentational component (no hooks)
// ---------------------------------------------------------------------------
// Shows:
//  - Disconnected state with "Connect Discord" button
//  - Connected state with guild badge, channel selector, test & disconnect
// ---------------------------------------------------------------------------

export const DiscordConnectionCard: React.FC<DiscordConnectionCardProps> = ({
  connection,
  channels,
  selectedChannelId,
  isLoading,
  isConnecting,
  isSaving,
  isTesting,
  isDisconnecting,
  testResult,
  hasChannelChanges,
  onConnect,
  onChannelSelect,
  onSaveChannel,
  onDiscardChannel,
  onTestConnection,
  onDisconnect,
}) => {
  const textChannels = channels.filter((c) => c.type === "text");
  const isConnected = !!connection;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Discord</CardTitle>
          {isConnected && connection.guildName && (
            <Badge variant="secondary" className="text-xs">
              {connection.guildName}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading...</span>
          </div>
        ) : !isConnected ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connect the Almirant bot to your Discord server to receive
              notifications about work items, sprints, and more.
            </p>
            <Button onClick={onConnect} disabled={isConnecting} size="sm">
              {isConnecting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Connect Discord
            </Button>
          </div>
        ) : (
          <>
            {/* Default channel selector */}
            <div className="space-y-1.5">
              <Label
                htmlFor="discord-default-channel"
                className="text-xs text-muted-foreground"
              >
                Default Channel
              </Label>
              <Select
                value={selectedChannelId ?? connection.defaultChannelId ?? ""}
                onValueChange={onChannelSelect}
                disabled={isSaving || isLoading}
              >
                <SelectTrigger id="discord-default-channel" className="h-9">
                  <SelectValue placeholder="Select a channel..." />
                </SelectTrigger>
                <SelectContent>
                  {textChannels.map((channel) => (
                    <SelectItem key={channel.id} value={channel.id}>
                      #{channel.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Test connection */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onTestConnection}
                disabled={isTesting}
              >
                {isTesting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Test Connection
              </Button>

              {testResult && (
                <span className="flex items-center gap-1 text-xs">
                  {testResult.sent ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      <span className="text-green-600">Message sent</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-3.5 w-3.5 text-destructive" />
                      <span className="text-destructive">
                        {testResult.error ?? "Failed"}
                      </span>
                    </>
                  )}
                </span>
              )}
            </div>

            {/* Disconnect */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onDisconnect}
              disabled={isDisconnecting}
              className="text-destructive hover:text-destructive"
            >
              {isDisconnecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Unplug className="mr-2 h-4 w-4" />
              )}
              Disconnect
            </Button>
          </>
        )}
      </CardContent>

      {hasChannelChanges && (
        <CardFooter className="flex justify-end gap-2 border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={onDiscardChannel}
            disabled={isSaving}
          >
            Discard
          </Button>
          <Button size="sm" onClick={onSaveChannel} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </CardFooter>
      )}
    </Card>
  );
};
