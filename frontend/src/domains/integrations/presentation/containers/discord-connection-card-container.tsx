"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfirmDialog } from "@/domains/shared/presentation/components/confirm-dialog";
import { DiscordConnectionCard } from "../components/discord-connection-card";
import type { UseDiscordConnectionReturn } from "../../domain/types";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DiscordConnectionCardContainerProps {
  discord: UseDiscordConnectionReturn & {
    confirmDialogProps: {
      isOpen: boolean;
      options: import("@/domains/shared/domain/types").ConfirmDialogOptions | null;
      handleConfirm: () => void;
      handleCancel: () => void;
    };
  };
}

// ---------------------------------------------------------------------------
// DiscordConnectionCardContainer
// ---------------------------------------------------------------------------
// Wires the useDiscordConnection hook to the presentational card inside a
// Sheet (side panel), following the same pattern as other integration panels.
// ---------------------------------------------------------------------------

export const DiscordConnectionCardContainer: React.FC<DiscordConnectionCardContainerProps> = ({
  discord,
}) => (
  <>
    <Sheet open={discord.dialogOpen} onOpenChange={(open) => !open && discord.closeDialog()}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Discord Integration</SheetTitle>
          <SheetDescription>
            Manage your Discord bot connection, default channel, and test notifications.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-8rem)] pr-4 mt-4">
          <DiscordConnectionCard
            connection={discord.connection}
            channels={discord.channels}
            selectedChannelId={discord.selectedChannelId}
            isLoading={discord.isLoading}
            isConnecting={discord.isConnecting}
            isSaving={discord.isSaving}
            isTesting={discord.isTesting}
            isDisconnecting={discord.isDisconnecting}
            testResult={discord.testResult}
            hasChannelChanges={discord.hasChannelChanges}
            onConnect={discord.handleConnect}
            onChannelSelect={discord.handleChannelSelect}
            onSaveChannel={discord.handleSaveChannel}
            onDiscardChannel={discord.handleDiscardChannel}
            onTestConnection={discord.handleTestConnection}
            onDisconnect={discord.handleDisconnect}
          />
        </ScrollArea>
      </SheetContent>
    </Sheet>

    <ConfirmDialog
      isOpen={discord.confirmDialogProps.isOpen}
      options={discord.confirmDialogProps.options}
      onConfirm={discord.confirmDialogProps.handleConfirm}
      onCancel={discord.confirmDialogProps.handleCancel}
    />
  </>
);
