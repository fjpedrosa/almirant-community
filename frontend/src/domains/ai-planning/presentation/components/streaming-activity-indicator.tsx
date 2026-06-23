import { useEffect, useState, useRef } from "react";

const ACTIVITY_MESSAGES = [
  "Analizando el contexto del proyecto...",
  "Revisando la arquitectura existente...",
  "Explorando dependencias y relaciones...",
  "Evaluando enfoques posibles...",
  "Estructurando la respuesta...",
  "Consultando la documentacion del proyecto...",
  "Identificando patrones relevantes...",
  "Preparando recomendaciones...",
];

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

  // Keep last real activity visible for a grace period before falling back to rotation
  const [displayActivity, setDisplayActivity] = useState<string | null>(null);
  useEffect(() => {
    if (latestActivity) {
      setDisplayActivity(latestActivity);
      setFadeIn(true);
    } else if (displayActivity) {
      // Keep showing last activity for 3s before clearing
      const timer = setTimeout(() => setDisplayActivity(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [latestActivity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rotate messages with fade (only when no real activity)
  useEffect(() => {
    if (displayActivity) return; // Skip rotation when showing real/recent activity
    const interval = setInterval(() => {
      setFadeIn(false);
      setTimeout(() => {
        setMessageIndex((prev) => (prev + 1) % ACTIVITY_MESSAGES.length);
        setFadeIn(true);
      }, 300);
    }, 3000);
    return () => clearInterval(interval);
  }, [displayActivity]);

  // Sparkle
  useEffect(() => {
    const interval = setInterval(() => {
      setSparklePhase((prev) => (prev + 1) % 4);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = minutes > 0
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
          Procesando...
        </span>
        <span className="text-muted-foreground text-sm tabular-nums">
          ({timeStr}{totalTokens != null && totalTokens > 0 && ` \u00B7 \u2193 ${formatTokens(totalTokens)} tokens`})
        </span>
      </div>
      <div className="flex items-center gap-2 ml-5 min-h-[1.25rem]">
        <span className="text-muted-foreground/50 text-sm">{"\u2514"}</span>
        <span
          className={`text-muted-foreground/70 text-sm transition-opacity duration-300 ${
            fadeIn ? "opacity-100" : "opacity-0"
          }`}
        >
          {displayActivity || ACTIVITY_MESSAGES[messageIndex]}
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
