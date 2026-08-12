"use client";

import { use } from "react";
import { NotesPageContainer } from "@/domains/notes/presentation/containers/notes-page-container";

export default function NotesAgendaPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = use(params);
  return <NotesPageContainer agendaDate={date} />;
}
