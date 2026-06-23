import { useEffect, useState, useRef } from "react";
import { useTranslations } from "next-intl";

interface StreamingActivityIndicatorProps {
  startedAt?: number;
  totalTokens?: number;
  /** Latest real tool activity — when provided, shows this instead of fake rotating messages. */
  latestActivity?: string | null;
}

const formatTokens = (n: number): string => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

export const StreamingActivityIndicator: React.FC<StreamingActivityIndicatorProps> = ({
  startedAt,
  totalTokens,
  latestActivity,
}) => {
  const t = useTranslations("aiPlanning");
  const activityMessages = t.raw("activityMessages") as string[];
  const [elapsed, setElapsed] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const [sparklePhase, setSparklePhase] = useState(0);
  const [fadeIn, setFadeIn] = useState(true);
  const startRef = useRef(startedAt ?? Date.now());

  // Timer
  useEffect(() => {
    startRef.current = startedAt ?? Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  // Rotate messages with fade (only when no real activity)
  useEffect(() => {
    if (latestActivity) return; // Skip rotation when showing real activity
    const interval = setInterval(() => {
      setFadeIn(false);
      setTimeout(() => {
        setMessageIndex((prev) => (prev + 1) % activityMessages.length);
        setFadeIn(true);
      }, 300);
    }, 3000);
    return () => clearInterval(interval);
  }, [latestActivity]);

  // Instant fade-in when latestActivity changes
  useEffect(() => {
    if (latestActivity) {
      setFadeIn(true);
    }
  }, [latestActivity]);

  // Sparkle
  useEffect(() => {
    const interval = setInterval(() => {
      setSparklePhase((prev) => (prev + 1) % 4);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const minutes = Math.floor(elapsed / 60);
  const hours = Math.floor(elapsed / 3600);
  const remainingMinutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  const timeStr = hours > 0
    ? `${hours}h ${remainingMinutes}m ${seconds.toString().padStart(2, "0")}s`
    : minutes > 0
    ? `${minutes}m ${seconds.toString().padStart(2, "0")}s`
    : `${seconds}s`;

  const sparkleChars = ["\u2726", "\u2727", "\u2726", "\u27E1"];
  const sparkle = sparkleChars[sparklePhase];

  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="flex items-center gap-2">
        <span
          className="text-primary text-base font-medium inline-flex items-center justify-center w-5 animate-pulse motion-reduce:animate-none"
          aria-hidden="true"
        >
          {sparkle}
        </span>
        <span className="streaming-shimmer text-base font-medium">
          {t("processing")}
        </span>
        <span className="text-muted-foreground text-sm tabular-nums">
          ({timeStr}{totalTokens != null && totalTokens > 0 && ` \u00B7 \u2193 ${formatTokens(totalTokens)} tokens`})
        </span>
      </div>
      <div className="flex items-center gap-2 ml-5 min-h-[1.25rem] min-w-0 max-w-full">
        <span className="text-muted-foreground/50 text-sm shrink-0">{"\u2514"}</span>
        <span
          className={`text-muted-foreground/70 text-sm transition-opacity duration-300 truncate min-w-0 ${
            fadeIn ? "opacity-100" : "opacity-0"
          }`}
        >
          {latestActivity || activityMessages[messageIndex]}
        </span>
      </div>

      {/* Shimmer animation via inline style tag — scoped to this component */}
      <style>{`
        .streaming-shimmer {
          background: linear-gradient(
            90deg,
            #a78bfa 0%,
            #a78bfa 35%,
            #e0d4ff 50%,
            #a78bfa 65%,
            #a78bfa 100%
          );
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: shimmer 2.5s ease-in-out infinite;
        }
        @keyframes shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  );
};
