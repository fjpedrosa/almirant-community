"use client";

import { useSessionResultPanel } from "../../application/hooks/use-session-result-panel";
import { SessionResultPanel } from "../components/session-result-panel";

interface SessionResultPanelContainerProps {
  payload: unknown;
}

export const SessionResultPanelContainer: React.FC<
  SessionResultPanelContainerProps
> = ({ payload }) => {
  const panel = useSessionResultPanel(payload);

  return <SessionResultPanel {...panel} />;
};
