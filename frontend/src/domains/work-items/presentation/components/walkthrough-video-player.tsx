import { Monitor, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { WalkthroughRecording } from "../../domain/types";

interface WalkthroughVideoPlayerProps {
  recording: WalkthroughRecording;
  isOpen: boolean;
  onClose: () => void;
}

const formatDuration = (seconds?: number): string => {
  if (seconds === undefined || seconds === null) return "";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
};

export const WalkthroughVideoPlayer: React.FC<WalkthroughVideoPlayerProps> = ({
  recording,
  isOpen,
  onClose,
}) => {
  const isDesktop = recording.viewport === "desktop";
  const ViewportIcon = isDesktop ? Monitor : Smartphone;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={`max-w-[90vw] max-h-[85vh] p-4 flex flex-col ${
          isDesktop ? "sm:max-w-4xl" : "sm:max-w-sm"
        }`}
      >
        <DialogHeader className="flex-row items-center gap-2 space-y-0">
          <ViewportIcon className="h-4 w-4 text-muted-foreground" />
          <DialogTitle className="text-base">
            Walkthrough Recording
          </DialogTitle>
          <Badge variant="outline" className="capitalize text-xs">
            {recording.viewport}
          </Badge>
          {recording.duration != null && (
            <DialogDescription className="text-xs text-muted-foreground ml-auto">
              {formatDuration(recording.duration)}
            </DialogDescription>
          )}
        </DialogHeader>

        <div
          className={`relative w-full flex items-center justify-center overflow-hidden rounded-md bg-black ${
            isDesktop ? "aspect-video" : "aspect-[9/16] max-h-[70vh] mx-auto"
          }`}
        >
          {recording.attachmentUrl ? (
            <video
              src={recording.attachmentUrl}
              controls
              autoPlay
              preload="metadata"
              className="w-full h-full object-contain"
            >
              Your browser does not support the video element.
            </video>
          ) : (
            <div className="flex items-center justify-center text-muted-foreground text-sm">
              Video not available
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
