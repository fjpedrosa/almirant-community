"use client";

import { use } from "react";
import { NotesPageContainer } from "@/domains/notes/presentation/containers/notes-page-container";

export default function NotePage({ params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = use(params);
  return <NotesPageContainer pageId={pageId} />;
}
