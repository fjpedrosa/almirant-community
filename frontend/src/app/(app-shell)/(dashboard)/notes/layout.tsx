import type { ReactNode } from "react";
import { NotesShellLayout } from "@/domains/notes/presentation/containers/notes-shell-layout";

export default function NotesLayout({ children }: { children: ReactNode }) {
  return <NotesShellLayout>{children}</NotesShellLayout>;
}
