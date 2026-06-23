"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { useSessionReplay } from "../../application/hooks/use-session-replay";
import { SessionReplayView } from "../components/session-replay-view";

interface SessionReplayContainerProps {
  sessionId: string;
}

const formatDuration = (ms: number | null): string => {
  if (!ms) return "";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
};

export const SessionReplayContainer: React.FC<SessionReplayContainerProps> = ({
  sessionId,
}) => {
  const router = useRouter();
  const { formatRelative, formatDateTime } = useFormattedDate();

  const { session, messages, isLoading, error } =
    useSessionReplay(sessionId);

  const handleBack = useCallback(() => {
    router.push("/plan/history");
  }, [router]);

  return (
    <SessionReplayView
      session={session}
      messages={messages}
      isLoading={isLoading}
      error={error}
      formatDate={formatRelative}
      formatDateTime={formatDateTime}
      formatDuration={formatDuration}
      onBack={handleBack}
    />
  );
};
