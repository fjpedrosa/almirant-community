import { Video, Monitor, Smartphone, Play, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  WalkthroughStatus,
  WalkthroughScript,
  WalkthroughRecording,
  WalkthroughViewport,
} from "../../domain/types";
import { WalkthroughVideoPlayer } from "./walkthrough-video-player";

interface WalkthroughSectionProps {
  status?: WalkthroughStatus;
  currentScript?: WalkthroughScript;
  recordings: WalkthroughRecording[];
  canStart: boolean;
  isStarting: boolean;
  onStart: (viewport: WalkthroughViewport) => void;
  selectedRecording: WalkthroughRecording | null;
  onSelectRecording: (recording: WalkthroughRecording | null) => void;
}

const STATUS_STYLES: Record<WalkthroughStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400" },
  script_pending: { label: "Script Pending", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400" },
  script_approved: { label: "Script Approved", className: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400" },
  recording: { label: "Recording", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400 animate-pulse" },
  completed: { label: "Completed", className: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400" },
};

const formatDate = (dateStr: string): string => {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
};

const formatDuration = (seconds?: number): string => {
  if (seconds === undefined || seconds === null) return "-";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
};

const RecordingRow: React.FC<{
  recording: WalkthroughRecording;
  onSelect: (recording: WalkthroughRecording) => void;
}> = ({ recording, onSelect }) => {
  const hasVideo = !!recording.attachmentUrl;

  return (
    <button
      type="button"
      onClick={() => hasVideo && onSelect(recording)}
      disabled={!hasVideo}
      className={`flex items-center gap-2 rounded-lg border bg-card p-2 text-xs w-full text-left transition-colors ${
        hasVideo
          ? "hover:bg-accent hover:border-accent-foreground/20 cursor-pointer"
          : "opacity-60 cursor-not-allowed"
      }`}
    >
      <Play
        className={`h-3.5 w-3.5 shrink-0 ${
          hasVideo ? "text-primary" : "text-muted-foreground"
        }`}
      />
      {recording.viewport === "desktop" ? (
        <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      ) : (
        <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}
      <span className="capitalize">{recording.viewport}</span>
      <span className="text-muted-foreground">
        {formatDuration(recording.duration)}
      </span>
      {!hasVideo && (
        <Badge variant="outline" className="text-[10px] px-1 py-0">
          Pending
        </Badge>
      )}
      <span className="ml-auto text-muted-foreground">
        {formatDate(recording.recordedAt)}
      </span>
    </button>
  );
};

export const WalkthroughSection: React.FC<WalkthroughSectionProps> = ({
  status,
  currentScript,
  recordings,
  canStart,
  isStarting,
  onStart,
  selectedRecording,
  onSelectRecording,
}) => {
  const desktopRecordings = recordings.filter((r) => r.viewport === "desktop");
  const mobileRecordings = recordings.filter((r) => r.viewport === "mobile");

  return (
    <div className="space-y-3">
      {/* Status badge */}
      {status && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status:</span>
          <Badge
            variant="outline"
            className={STATUS_STYLES[status].className}
          >
            {STATUS_STYLES[status].label}
          </Badge>
        </div>
      )}

      {/* Start button */}
      {canStart && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={isStarting}>
              <Video className="h-4 w-4 mr-1.5" />
              {isStarting ? "Starting..." : "Record Walkthrough"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onStart("desktop")}>
              <Monitor className="h-4 w-4 mr-2" />
              Desktop
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onStart("mobile")}>
              <Smartphone className="h-4 w-4 mr-2" />
              Mobile
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Script preview */}
      {currentScript && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-2 w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-1 group cursor-pointer">
            <Play className="h-3.5 w-3.5" />
            <span>Script v{currentScript.version}</span>
            <ChevronDown className="h-3.5 w-3.5 ml-auto transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="rounded-lg border bg-card p-3 space-y-2">
              <pre className="text-xs whitespace-pre-wrap text-foreground leading-relaxed">
                {currentScript.content}
              </pre>
              <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground pt-1 border-t">
                <span>Generated: {formatDate(currentScript.generatedAt)}</span>
                {currentScript.approvedAt && (
                  <span>Approved: {formatDate(currentScript.approvedAt)}</span>
                )}
                {currentScript.rejectedAt && (
                  <span className="text-red-500">
                    Rejected: {formatDate(currentScript.rejectedAt)}
                    {currentScript.rejectionReason && ` - ${currentScript.rejectionReason}`}
                  </span>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Recordings grouped by viewport */}
      {recordings.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Recordings</p>

          {desktopRecordings.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                <Monitor className="h-3 w-3" />
                Desktop
              </div>
              {desktopRecordings.map((rec) => (
                <RecordingRow
                  key={rec.id}
                  recording={rec}
                  onSelect={onSelectRecording}
                />
              ))}
            </div>
          )}

          {mobileRecordings.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                <Smartphone className="h-3 w-3" />
                Mobile
              </div>
              {mobileRecordings.map((rec) => (
                <RecordingRow
                  key={rec.id}
                  recording={rec}
                  onSelect={onSelectRecording}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Video player dialog */}
      {selectedRecording && (
        <WalkthroughVideoPlayer
          recording={selectedRecording}
          isOpen={!!selectedRecording}
          onClose={() => onSelectRecording(null)}
        />
      )}

      {/* Empty state */}
      {!status && recordings.length === 0 && !currentScript && (
        <p className="text-sm text-muted-foreground">
          No walkthrough recorded yet.
        </p>
      )}
    </div>
  );
};
