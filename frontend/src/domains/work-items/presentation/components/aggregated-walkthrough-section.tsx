import { Play, Monitor, Smartphone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WalkthroughRecording } from "../../domain/types";
import { WalkthroughVideoPlayer } from "./walkthrough-video-player";

export interface AggregatedWalkthroughEntry {
  taskId: string | null;
  title: string;
  recordings: WalkthroughRecording[];
}

interface AggregatedWalkthroughSectionProps {
  entries: AggregatedWalkthroughEntry[];
  selectedRecording: WalkthroughRecording | null;
  onSelectRecording: (recording: WalkthroughRecording | null) => void;
}

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

export const AggregatedWalkthroughSection: React.FC<AggregatedWalkthroughSectionProps> = ({
  entries,
  selectedRecording,
  onSelectRecording,
}) => {
  const showHeaders = entries.length > 1;

  return (
    <div className="space-y-3">
      {entries.map((entry) => (
        <div key={entry.taskId ?? entry.title}>
          {showHeaders && (
            <p className="text-[10px] font-semibold text-muted-foreground mb-1">
              {entry.taskId ?? "—"} · {entry.title}
            </p>
          )}
          <div className="space-y-1.5">
            {entry.recordings.map((rec) => (
              <RecordingRow
                key={rec.id}
                recording={rec}
                onSelect={onSelectRecording}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Video player dialog */}
      {selectedRecording && (
        <WalkthroughVideoPlayer
          recording={selectedRecording}
          isOpen={!!selectedRecording}
          onClose={() => onSelectRecording(null)}
        />
      )}
    </div>
  );
};
