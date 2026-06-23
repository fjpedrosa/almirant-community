import { use } from "react";
import { SessionReplayContainer } from "@/domains/planning/presentation/containers/session-replay-container";

interface SessionReplayPageProps {
  params: Promise<{ sessionId: string }>;
}

export default function SessionReplayPage({ params }: SessionReplayPageProps) {
  const { sessionId } = use(params);
  return <SessionReplayContainer sessionId={sessionId} />;
}
