"use client";

import { usePathname } from "next/navigation";
import { useMemo } from "react";

export const TAB_ROUTES: Record<string, string> = {
  boards: "/board",
  projects: "/projects",
  roadmap: "/roadmap",
  seeds: "/seeds",
  plan: "/plan",
  ideas: "/ideas",
  todos: "/todos",
  ask: "/ask",
  docs: "/docs",
  handbook: "/handbook",
  agents: "/agents",
  settings: "/settings",
  expenses: "/expenses",
  analytics: "/analytics",
  goals: "/goals",
  teams: "/teams",
};

const deriveActiveTab = (pathname: string): string => {
  if (pathname === "/") {
    return "plan";
  }

  if (pathname.startsWith("/board")) {
    return "boards";
  }

  if (pathname.startsWith("/projects")) {
    return "projects";
  }

  if (pathname.startsWith("/roadmap")) {
    return "roadmap";
  }

  if (pathname.startsWith("/seeds")) {
    return "seeds";
  }

  if (pathname.startsWith("/plan")) {
    return "plan";
  }

  if (pathname.startsWith("/sessions")) {
    return "agents";
  }

  if (pathname.startsWith("/ideas")) {
    return "ideas";
  }

  if (pathname.startsWith("/todos")) {
    return "todos";
  }

  if (pathname.startsWith("/ask")) {
    return "ask";
  }

  if (pathname.startsWith("/agents")) {
    return "agents";
  }

  if (pathname.startsWith("/docs")) {
    return "docs";
  }

  if (pathname.startsWith("/handbook")) {
    return "handbook";
  }

  if (pathname.startsWith("/settings")) {
    return "settings";
  }

  if (pathname.startsWith("/expenses")) {
    return "expenses";
  }

  if (pathname.startsWith("/analytics")) {
    return "analytics";
  }

  if (pathname.startsWith("/goals")) {
    return "goals";
  }

  if (pathname.startsWith("/teams")) {
    return "teams";
  }

  if (pathname.startsWith("/skill-interview")) {
    return "agents";
  }

  if (pathname.startsWith("/backoffice")) {
    return "";
  }

  return "plan";
};

/**
 * Checks if the current path is within the Brain section.
 * Used to highlight the Brain dropdown trigger in navigation.
 */
const deriveBrainActive = (pathname: string): boolean => {
  return pathname.startsWith("/docs") || pathname.startsWith("/ask") || pathname.startsWith("/handbook");
};

export const useNavigation = () => {
  const pathname = usePathname();

  const activeTab = useMemo(() => deriveActiveTab(pathname), [pathname]);
  const isBrainActive = useMemo(() => deriveBrainActive(pathname), [pathname]);

  return { activeTab, isBrainActive };
};
