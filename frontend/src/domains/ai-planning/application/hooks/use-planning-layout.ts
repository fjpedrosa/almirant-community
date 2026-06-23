"use client";

import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Hook: usePlanningLayout
// ---------------------------------------------------------------------------
// Manages layout state: mobile sidebar toggle.
// showChatPanel and showChat are derived in the orchestrator since they
// depend on lifecycle and messages state.
// ---------------------------------------------------------------------------

export const usePlanningLayout = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const handleToggleMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen((prev) => !prev);
  }, []);

  return {
    isMobileSidebarOpen,
    setMobileSidebarOpen: setIsMobileSidebarOpen,
    onToggleMobileSidebar: handleToggleMobileSidebar,
  };
};
