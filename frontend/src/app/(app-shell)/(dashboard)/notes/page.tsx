"use client";

import { useEffect, useState } from "react";
import { formatLocalDate } from "@/domains/notes/domain/date";
import { NotesPageContainer } from "@/domains/notes/presentation/containers/notes-page-container";

export default function NotesTodayPage() {
  const [today, setToday] = useState<string | null>(() => typeof window === "undefined" ? null : formatLocalDate());
  useEffect(() => {
    const timer = window.setInterval(() => setToday((current) => {
      const next = formatLocalDate();
      return current === next ? current : next;
    }), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!today) return null;
  return <NotesPageContainer agendaDate={today} />;
}
