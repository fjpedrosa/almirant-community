"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  isToday,
  isYesterday,
  isThisWeek,
  formatDistanceToNow,
} from "date-fns";
import { es } from "date-fns/locale";
import { planningSessionsApi } from "@/domains/planning/infrastructure/api/planning-api";
import { planningSessionKeys } from "@/domains/planning/domain/query-keys";
import { useDeleteSession } from "@/domains/planning/application/hooks/use-session-history";
import type { PlanningSession } from "@/domains/planning/domain/types";

// ---------------------------------------------------------------------------
// Date grouping helpers
// ---------------------------------------------------------------------------

interface SessionGroup {
  label: string;
  sessions: Array<{
    id: string;
    title: string;
    relativeDate: string;
    creatorName: string | null;
    creatorImage: string | null;
    status: string;
    createdAt: string;
  }>;
}

const GROUP_LABELS = {
  today: "Hoy",
  yesterday: "Ayer",
  thisWeek: "Esta semana",
  older: "Anteriores",
} as const;

const groupSessionsByDate = (sessions: PlanningSession[]): SessionGroup[] => {
  const buckets: Record<string, SessionGroup> = {
    today: { label: GROUP_LABELS.today, sessions: [] },
    yesterday: { label: GROUP_LABELS.yesterday, sessions: [] },
    thisWeek: { label: GROUP_LABELS.thisWeek, sessions: [] },
    older: { label: GROUP_LABELS.older, sessions: [] },
  };

  for (const session of sessions) {
    const date = new Date(session.createdAt);
    const relativeDate = formatDistanceToNow(date, {
      addSuffix: true,
      locale: es,
    });

    const entry = {
      id: session.id,
      title: session.title || "Sin titulo",
      relativeDate,
      creatorName: session.createdByUserName ?? null,
      creatorImage: session.createdByUserImage ?? null,
      status: session.status,
      createdAt: session.createdAt,
    };

    if (isToday(date)) {
      buckets.today.sessions.push(entry);
    } else if (isYesterday(date)) {
      buckets.yesterday.sessions.push(entry);
    } else if (isThisWeek(date, { weekStartsOn: 1 })) {
      buckets.thisWeek.sessions.push(entry);
    } else {
      buckets.older.sessions.push(entry);
    }
  }

  // Only return non-empty groups
  return Object.values(buckets).filter((g) => g.sessions.length > 0);
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const SIDEBAR_LIMIT = 50;

export const useSessionSidebar = () => {
  const [isOpen, setIsOpen] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const deleteMutation = useDeleteSession();

  // Fetch latest sessions (simple list, no URL-synced pagination)
  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(SIDEBAR_LIMIT));
    p.set("page", "1");
    return p;
  }, []);

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: planningSessionKeys.list(`sidebar:limit=${SIDEBAR_LIMIT}`),
    queryFn: async () => {
      const result = await planningSessionsApi.list(params);
      return result;
    },
  });

  // Group sessions by date
  const groups = useMemo(() => groupSessionsByDate(sessions), [sessions]);

  // Handlers
  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleSessionClick = useCallback((id: string) => {
    setActiveSessionId(id);
  }, []);

  const handleSessionDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
      // If we deleted the active session, clear selection
      if (activeSessionId === id) {
        setActiveSessionId(null);
      }
    },
    [deleteMutation, activeSessionId],
  );

  const handleNewSession = useCallback(() => {
    setActiveSessionId(null);
  }, []);

  return {
    isOpen,
    groups,
    activeSessionId,
    isLoading,
    onToggle: handleToggle,
    onSessionClick: handleSessionClick,
    onSessionDelete: handleSessionDelete,
    onNewSession: handleNewSession,
  };
};
