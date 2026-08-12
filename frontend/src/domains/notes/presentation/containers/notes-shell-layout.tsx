"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAgendaMonth, useNotesCommands, useNotesSearch, useNotesTree } from "../../application/use-notes";
import { agendaMonth, formatLocalDate, shiftAgendaMonth } from "../../domain/date";
import { buildNoteTree } from "../../domain/tree";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { AgendaCalendar } from "../components/agenda-calendar";
import { NotesSidebar } from "../components/notes-sidebar";
import { NotesShellContextProvider, useNotesShell } from "./notes-shell-context";

const NotesShellBody = ({ children }: { children: ReactNode }) => {
  const t = useTranslations("notes");
  const locale = useLocale();
  const router = useRouter();
  const tree = useNotesTree();
  const commands = useNotesCommands();
  const activeTeam = useActiveTeam();
  const { activePageId, selectedDate, flushCurrentPage } = useNotesShell();
  const currentUrlRef = useRef<string>("");
  const [navigationError, setNavigationError] = useState(false);
  const [search, setSearch] = useState("");
  const [today, setToday] = useState(() => formatLocalDate());
  useEffect(() => {
    currentUrlRef.current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.replaceState({ notesNavigationGuard: true }, "", currentUrlRef.current);
    const onPopState = (event: PopStateEvent) => {
      const target = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const current = currentUrlRef.current;
      if (target === current) return;
      // popstate cannot be cancelled. Restore the current entry immediately,
      // then commit the requested URL only after the dirty editor has flushed.
      window.history.pushState({ notesNavigationGuard: true }, "", current);
      void flushCurrentPage()
        .then(() => {
          setNavigationError(false);
          currentUrlRef.current = target;
          router.push(target);
        })
        .catch(() => setNavigationError(true));
      void event;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [flushCurrentPage, router]);

  useEffect(() => {
    const timer = window.setInterval(() => setToday((current) => {
      const next = formatLocalDate();
      return next === current ? current : next;
    }), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const effectiveDate = selectedDate ?? today;
  const selectedMonth = agendaMonth(effectiveDate);
  const [calendar, setCalendar] = useState(() => ({ anchor: selectedMonth, value: selectedMonth }));
  const month = calendar.anchor === selectedMonth ? calendar.value : selectedMonth;
  const monthQuery = useAgendaMonth(month);
  const searchQuery = useNotesSearch(search);

  // A Notes draft must be acknowledged before any in-app link leaves the editor,
  // including product navigation rendered outside the Notes shell.
  useEffect(() => {
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const href = `${url.pathname}${url.search}${url.hash}`;
      event.preventDefault();
      void flushCurrentPage().then(() => {
        setNavigationError(false);
        currentUrlRef.current = href;
        router.push(href);
      }).catch(() => setNavigationError(true));
    };
    document.addEventListener("click", navigate, true);
    return () => document.removeEventListener("click", navigate, true);
  }, [flushCurrentPage, router]);

  const visibleTree = useMemo(() => {
    if (!search.trim()) return tree.tree;
    return buildNoteTree(searchQuery.data?.items ?? []);
  }, [search, searchQuery.data?.items, tree.tree]);

  const collectionError = tree.isError ? tree.refetch : search.trim() ? (searchQuery.isError ? searchQuery.refetch : null) : (monthQuery.isError ? monthQuery.refetch : null);

  const createPage = async () => {
    await flushCurrentPage();
    const created = await commands.create.mutateAsync({ title: t("editor.titlePlaceholder"), visibility: "private" });
    router.push(`/notes/${created.id}`);
  };

  return (
    <div data-notes-shell className="flex h-full min-h-[calc(100dvh-4rem)] overflow-hidden bg-background md:min-h-0">
      <NotesSidebar
        pages={visibleTree}
        activePageId={activePageId}
        search={search}
        onSearchChange={setSearch}
        onCreatePage={() => { void createPage(); }}
        labels={{
          navigation: t("shell.navigation"),
          today: t("shell.today"),
          pages: t("shell.pages"),
          archive: t("shell.archive"),
          open: t("shell.open"),
          search: t("shell.search"),
          newPage: t("shell.newPage"),
          untitled: t("shell.untitled"),
          expand: (title) => t("shell.expand", { title }),
          collapse: (title) => t("shell.collapse", { title }),
        }}
        footer={(
          <AgendaCalendar
            month={month}
            selectedDate={effectiveDate}
            daysWithNotes={monthQuery.items.map((page) => page.dailyDate).filter((value): value is string => value !== null)}
            labels={{
              calendar: new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(`${month}-15T12:00:00`)),
              previous: t("agenda.previousMonth"),
              next: t("agenda.nextMonth"),
              noted: t("agenda.notedDate"),
            }}
            locale={locale}
            onSelectDate={(date) => { void flushCurrentPage().then(() => { setNavigationError(false); router.push(date === today ? "/notes" : `/notes/agenda/${date}`); }).catch(() => setNavigationError(true)); }}
            dayLabel={(date) => new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", year: "numeric" }).format(new Date(`${date}T12:00:00`))}
            onPreviousMonth={() => setCalendar({ anchor: selectedMonth, value: shiftAgendaMonth(month, -1) })}
            onNextMonth={() => setCalendar({ anchor: selectedMonth, value: shiftAgendaMonth(month, 1) })}
          />
        )}
      />
      {collectionError && (
        <div role="alert" className="fixed inset-x-4 top-20 z-30 mx-auto max-w-xl rounded-md border border-destructive/40 bg-background px-3 py-2 text-sm text-destructive shadow-lg">
          <span>{t("errors.generic")}</span>
          <Button type="button" variant="ghost" size="xs" className="ml-2" onClick={() => { void collectionError(); }}>{t("errors.retry")}</Button>
        </div>
      )}
      {navigationError && (
        <div role="alert" className="fixed inset-x-4 top-20 z-40 mx-auto max-w-xl rounded-md border border-destructive/40 bg-background px-3 py-2 text-sm text-destructive shadow-lg">
          {t("errors.navigationFlush")}
        </div>
      )}
      <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {!activeTeam.isLoading && !activeTeam.confirmedActiveTeamId ? (
          <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-6 text-center" role="status">
            <h1 className="text-xl font-semibold">{t("shell.noWorkspace")}</h1>
          </main>
        ) : children}
      </div>
    </div>
  );
};

export const NotesShellLayout = ({ children }: { children: ReactNode }) => (
  <NotesShellContextProvider>
    <NotesShellBody>{children}</NotesShellBody>
  </NotesShellContextProvider>
);
