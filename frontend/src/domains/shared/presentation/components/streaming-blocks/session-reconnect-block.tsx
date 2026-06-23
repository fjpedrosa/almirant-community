import { RotateCcw } from "lucide-react";

interface SessionReconnectBlockProps {
  timestamp: string;
}

const formatReconnectTime = (timestamp: string): string => {
  try {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return timestamp;
  }
};

export const SessionReconnectBlock: React.FC<SessionReconnectBlockProps> = ({
  timestamp,
}) => {
  return (
    <div className="flex items-center gap-3 py-3 my-1">
      <div className="flex-1 border-t border-amber-500/30" />
      <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 whitespace-nowrap">
        <RotateCcw className="h-3 w-3" />
        Session reconnected · {formatReconnectTime(timestamp)}
      </span>
      <div className="flex-1 border-t border-amber-500/30" />
    </div>
  );
};
