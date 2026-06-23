"use client";

import { useMemo } from "react";
import { useWorkItemAgentSession } from "../../application/hooks/use-work-item-agent-session";
import { SessionsTabContent } from "../components/sessions-tab-content";

interface SessionsTabContainerProps {
  workItemId: string;
}

export const SessionsTabContainer: React.FC<SessionsTabContainerProps> = ({
  workItemId,
}) => {
  const { sessions, isLoading } = useWorkItemAgentSession(workItemId);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot time per render cycle
  const currentTime = useMemo(() => Date.now(), [sessions]);

  return <SessionsTabContent sessions={sessions} isLoading={isLoading} currentTime={currentTime} />;
};
