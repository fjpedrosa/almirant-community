import { MessageSquare, Info } from "lucide-react";
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
import type {
  ProjectDiscordChannelData,
  DiscordChannelOption,
} from "../../domain/types";

interface ProjectDiscordChannelCardProps {
  channelData: ProjectDiscordChannelData | null;
  channels: DiscordChannelOption[];
  selectedChannelId: string | null;
  isLoading: boolean;
  isSaving: boolean;
  hasChanges: boolean;
  onChannelSelect: (channelId: string) => void;
  onSave: () => void;
  onDiscard: () => void;
}

export const ProjectDiscordChannelCard: React.FC<ProjectDiscordChannelCardProps> = ({
  channelData,
  channels,
  selectedChannelId,
  isLoading,
  isSaving,
  hasChanges,
  onChannelSelect,
  onSave,
  onDiscard,
}) => {
  const isConnected = channelData?.connection !== null;
  const textChannels = channels.filter((c) => c.type === "text");

  const effectiveChannelName = channelData?.projectChannel
    ? channelData.projectChannel.channelName
    : channelData?.connection?.defaultChannelName;

  const isOverride = !!channelData?.projectChannel;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Discord Channel</CardTitle>
          {isConnected && (
            <Badge variant="secondary" className="text-xs">
              {channelData?.connection?.guildName}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {!isConnected ? (
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              Discord not connected. Connect in Settings &gt; Integrations.
            </p>
          </div>
        ) : (
          <>
            <div className="text-sm text-muted-foreground">
              {isOverride ? (
                <span>
                  Current channel: <strong>#{effectiveChannelName}</strong>{" "}
                  (project override)
                </span>
              ) : (
                <span>
                  Using workspace default:{" "}
                  <strong>#{effectiveChannelName ?? "none"}</strong>
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="discord-channel-select"
                className="text-xs text-muted-foreground"
              >
                Channel override
              </Label>
              <Select
                value={selectedChannelId ?? ""}
                onValueChange={onChannelSelect}
                disabled={isSaving || isLoading}
              >
                <SelectTrigger id="discord-channel-select" className="h-9">
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

            {isSaving && (
              <p className="text-xs text-muted-foreground">Saving...</p>
            )}
          </>
        )}
      </CardContent>

      {hasChanges && (
        <CardFooter className="flex justify-end gap-2 border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={onDiscard}
            disabled={isSaving}
          >
            Discard
          </Button>
          <Button size="sm" onClick={onSave} disabled={isSaving}>
            Save Changes
          </Button>
        </CardFooter>
      )}
    </Card>
  );
};
