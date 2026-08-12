"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Flush = () => Promise<void>;

type NotesShellContextValue = {
  activePageId: string | null;
  selectedDate: string | null;
  flushCurrentPage: Flush;
  registerPage: (input: { activePageId: string | null; selectedDate: string | null; flush?: Flush }) => () => void;
};

const NotesShellContext = createContext<NotesShellContextValue | null>(null);

export const NotesShellContextProvider = ({ children }: { children: ReactNode }) => {
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [flush, setFlush] = useState<Flush>(() => async () => undefined);

  const registerPage = useCallback((input: { activePageId: string | null; selectedDate: string | null; flush?: Flush }) => {
    setActivePageId(input.activePageId);
    setSelectedDate(input.selectedDate);
    setFlush(() => input.flush ?? (async () => undefined));
    return () => {
      setActivePageId((current) => current === input.activePageId ? null : current);
      setSelectedDate((current) => current === input.selectedDate ? null : current);
      setFlush(() => async () => undefined);
    };
  }, []);

  const value = useMemo<NotesShellContextValue>(() => ({
    activePageId,
    selectedDate,
    flushCurrentPage: flush,
    registerPage,
  }), [activePageId, flush, registerPage, selectedDate]);

  return <NotesShellContext.Provider value={value}>{children}</NotesShellContext.Provider>;
};

export const useNotesShell = (): NotesShellContextValue => {
  const value = useContext(NotesShellContext);
  if (!value) throw new Error("NOTES_SHELL_CONTEXT_MISSING");
  return value;
};

export const useNotesShellRegistration = (input: {
  activePageId: string | null;
  selectedDate: string | null;
  flush?: Flush;
}) => {
  const { registerPage } = useNotesShell();
  const { activePageId, selectedDate, flush } = input;
  useEffect(
    () => registerPage({ activePageId, selectedDate, flush }),
    [activePageId, flush, registerPage, selectedDate],
  );
};
