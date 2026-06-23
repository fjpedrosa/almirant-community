import { SessionSidebar } from "../components/session-sidebar";
import { useSessionSidebar } from "../../application/hooks/use-session-sidebar";

// No-op handler for resume in standalone container (resume is handled by plan-chat-page)
const noop = () => {};

export const SessionSidebarContainer: React.FC = () => {
  const sidebar = useSessionSidebar();

  return (
    <SessionSidebar
      isOpen={sidebar.isOpen}
      groups={sidebar.groups}
      activeSessionId={sidebar.activeSessionId}
      onToggle={sidebar.onToggle}
      onSessionClick={sidebar.onSessionClick}
      onSessionDelete={sidebar.onSessionDelete}
      onSessionResume={noop}
      onNewSession={noop}
      onSearchOpen={noop}
    />
  );
};
