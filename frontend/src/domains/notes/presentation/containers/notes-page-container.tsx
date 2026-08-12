"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleAlert, Loader2, Plus, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTeamMembersSelect } from "@/domains/teams/application/hooks/use-team-members-select";
import { NotesAutosaveCoordinator, type AutosaveState, type AutosaveStatus } from "../../application/autosave-coordinator";
import { createCarryoverCoordinator, evictCarryoverCoordinator, resetCarryoverCoordinators } from "../../application/carryover-coordinator";
import {
  invalidateNotesCollections,
  useAgendaDay,
  useBacklinks,
  useCarryover,
  useChecklistItems,
  useNotePage,
  useNotesCommands,
  useNotesTree,
  useShares,
} from "../../application/use-notes";
import { isAgendaDate, shiftAgendaDate } from "../../domain/date";
import { isNoteVersionConflict } from "../../domain/errors";
import { notesKeys } from "../../domain/query-keys";
import { breadcrumbSegments } from "../../domain/tree";
import { cloneLexicalDocumentWithFreshChecklistIds, mergeChecklistCheckedState, normalizeLexicalDocumentForEditor, type LexicalJsonDocument } from "../../domain/lexical-contract";
import type { NoteCarryoverSummary, NotePage, NotePageDraft, NoteVisibility } from "../../domain/types";
import { NotesEditor, type NotesEditorHandle } from "../../editor/notes-editor";
import { CarryoverList } from "../components/carryover-list";
import { ConflictDialog } from "../components/conflict-dialog";
import { MoveDialog } from "../components/move-dialog";
import { NotePageActions } from "../components/note-page-actions";
import { ShareDialog } from "../components/share-dialog";
import { useNotesShellRegistration } from "./notes-shell-context";
import { ApiError } from "@/lib/api/client";

const statusKey: Record<AutosaveStatus, "statusDirty" | "statusSaving" | "statusSaved" | "statusError" | "versionConflict"> = {
  dirty: "statusDirty",
  saving: "statusSaving",
  saved: "statusSaved",
  error: "statusError",
  conflict: "versionConflict",
};

export const NotesPageContainer = ({ pageId, agendaDate }: { pageId?: string; agendaDate?: string }) => {
  const t = useTranslations("notes");
  const locale = useLocale();
  const router = useRouter();
  const dateIsValid = agendaDate === undefined || isAgendaDate(agendaDate);
  const pageQuery = useNotePage(pageId ?? null);
  const agendaQuery = useAgendaDay(agendaDate ?? "0000-00-00", Boolean(agendaDate && dateIsValid));
  const sourcePage = agendaDate ? agendaQuery.data : pageQuery.data;
  const sourcePageRef = useRef<NotePage | undefined>(sourcePage);
  sourcePageRef.current = sourcePage;
  const sourcePageId = sourcePage?.id;
  const resourceKey = agendaDate ? `agenda:${agendaDate}` : `page:${pageId ?? ""}`;
  const isLoading = agendaDate ? agendaQuery.isLoading : pageQuery.isLoading;
  const queryError = agendaDate ? agendaQuery.error : pageQuery.error;
  const tree = useNotesTree();
  const commands = useNotesCommands();
  const checklist = useChecklistItems(sourcePageId);
  const backlinks = useBacklinks(sourcePageId);
  const shares = useShares(sourcePageId, Boolean(sourcePage?.canManageShares));
  const carryover = useCarryover(agendaDate ?? "0000-00-00", Boolean(agendaDate && dateIsValid));
  const { members, error: membersQueryError, refetch: refetchMembers } = useTeamMembersSelect();
  const [page, setPage] = useState<NotePage | null>(null);
  const [draft, setDraft] = useState<NotePageDraft | null>(null);
  const pageRef = useRef<NotePage | null>(null);
  const draftRef = useRef<NotePageDraft | null>(null);
  const editorRef = useRef<NotesEditorHandle | null>(null);
  const coordinatorRef = useRef<NotesAutosaveCoordinator<NotePageDraft> | null>(null);
  const generationRef = useRef(0);
  const [autosave, setAutosave] = useState<AutosaveState<NotePageDraft>>({ status: "saved", localDraft: null, error: null });
  const [shareOpen, setShareOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [shareFlowError, setShareFlowError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [carryoverPending, setCarryoverPending] = useState<string | null>(null);
  const [carryoverError, setCarryoverError] = useState<string | null>(null);
  const [childError, setChildError] = useState<string | null>(null);
  const [conflictAction, setConflictAction] = useState<"reload" | "copy" | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState(false);
  const sharePending = commands.share.isPending || commands.removeShare.isPending;
  pageRef.current = page;

  useEffect(() => () => {
    // Carryover coordinators are short-lived source-page mutexes. The
    // coordinator module evicts them after each successful mutation; an
    // unmounted view must not retain stale source versions indefinitely.
    resetCarryoverCoordinators();
  }, []);

  const cachePage = useCallback((next: NotePage) => {
    commands.queryClient.setQueryData(notesKeys.page(commands.organizationId, next.id), next);
    if (next.dailyDate) commands.queryClient.setQueryData(notesKeys.agendaDay(commands.organizationId, next.dailyDate), next);
  }, [commands.organizationId, commands.queryClient]);

  const refreshSummaries = useCallback(() => {
    void invalidateNotesCollections(commands.queryClient, commands.organizationId);
  }, [commands.organizationId, commands.queryClient]);

  useEffect(() => {
    generationRef.current += 1;
    const previous = coordinatorRef.current;
    const previousPage = pageRef.current;
    const previousDraft = draftRef.current;
    if (previous) {
      void previous.flushAndDispose().catch(() => {
        // A resource transition must never discard a dirty draft when its
        // acknowledgement fails. Restore the prior snapshot and coordinator
        // so the user can retry or resolve the conflict in place.
        if (previousPage && previousDraft) {
          setPage(previousPage);
          setDraft(previousDraft);
          draftRef.current = previousDraft;
          setAutosave(previous.state);
          coordinatorRef.current = previous;
        }
        setNavigationError(true);
      });
    }
    coordinatorRef.current = null;
  }, [resourceKey]);

  useEffect(() => {
    const initial = sourcePageRef.current;
    if (!initial || initial.id !== sourcePageId) return;
    const generation = generationRef.current;
    const initialDraft = { title: initial.title, lexicalJson: normalizeLexicalDocumentForEditor(initial.lexicalJson) };
    setPage(initial);
    setDraft(initialDraft);
    draftRef.current = initialDraft;
    setAutosave({ status: "saved", localDraft: null, error: null });
    const coordinator = new NotesAutosaveCoordinator<NotePageDraft>({
      initialVersion: initial.stateVersion,
      delayMs: 2_000,
      isConflict: isNoteVersionConflict,
      onStatus: (next) => {
        if (generationRef.current === generation && sourcePageId === initial.id) setAutosave(next);
      },
      save: async (nextDraft, expectedVersion) => {
        const updated = await (await import("../../infrastructure/workspace-notes-api")).workspaceNotesApi.updatePage(initial.id, {
          expectedVersion,
          title: nextDraft.title,
          lexicalJson: nextDraft.lexicalJson,
        });
        if (generationRef.current === generation && sourcePageId === initial.id) {
          setPage(updated);
          cachePage(updated);
          refreshSummaries();
        }
        return updated;
      },
    });
    coordinatorRef.current = coordinator;
    return () => {
      void coordinator.flushAndDispose().catch(() => undefined);
      if (coordinatorRef.current === coordinator) coordinatorRef.current = null;
    };
  }, [cachePage, refreshSummaries, sourcePageId]);

  const flush = useCallback(async () => {
    await coordinatorRef.current?.flush();
  }, []);

  const navigateAfterFlush = useCallback(async (href: string) => {
    try {
      await flush();
      setNavigationError(false);
      router.push(href);
    } catch {
      setNavigationError(true);
      throw new Error("NOTES_NAVIGATION_FLUSH_FAILED");
    }
  }, [flush, router]);

  useNotesShellRegistration({
    activePageId: page?.id ?? pageId ?? null,
    selectedDate: agendaDate ?? null,
    flush,
  });

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (autosave.status === "saved") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [autosave.status]);

  const replaceWithSnapshot = useCallback((next: NotePage) => {
    const nextDraft = { title: next.title, lexicalJson: normalizeLexicalDocumentForEditor(next.lexicalJson) };
    setPage(next);
    setDraft(nextDraft);
    draftRef.current = nextDraft;
    cachePage(next);
    editorRef.current?.setDocument(next.lexicalJson);
  }, [cachePage]);

  const queueDraft = useCallback((next: NotePageDraft) => {
    draftRef.current = next;
    setDraft(next);
    coordinatorRef.current?.queue(next);
  }, []);

  const updateChecklist = useCallback(async (itemId: string, checked: boolean) => {
    const coordinator = coordinatorRef.current;
    if (!page || !coordinator) return;
    const wrapped = await coordinator.serialize(async (expectedVersion) => {
      const { workspaceNotesApi } = await import("../../infrastructure/workspace-notes-api");
      const result = await workspaceNotesApi.updateChecklistItem(page.id, itemId, { checked, expectedVersion });
      return { stateVersion: result.page.stateVersion, result };
    });
    const newerDraft = coordinator.state.localDraft;
    if (newerDraft) {
      const mergedDraft = {
        ...newerDraft,
        lexicalJson: mergeChecklistCheckedState(newerDraft.lexicalJson as LexicalJsonDocument, itemId, checked),
      };
      draftRef.current = mergedDraft;
      setDraft(mergedDraft);
      editorRef.current?.setDocument(mergedDraft.lexicalJson);
      setPage(wrapped.result.page);
      cachePage(wrapped.result.page);
      refreshSummaries();
      coordinator.queue(mergedDraft);
    } else {
      replaceWithSnapshot(wrapped.result.page);
    }
    await commands.queryClient.invalidateQueries({ queryKey: notesKeys.checklistItems(commands.organizationId, page.id) });
    if (page.dailyDate) await commands.queryClient.invalidateQueries({ queryKey: notesKeys.carryover(commands.organizationId, page.dailyDate) });
  }, [cachePage, commands.organizationId, commands.queryClient, page, refreshSummaries, replaceWithSnapshot]);

  const completeCarryover = useCallback(async (item: NoteCarryoverSummary) => {
    setCarryoverPending(item.itemId);
    setCarryoverError(null);
    try {
      await flush();
      const { workspaceNotesApi } = await import("../../infrastructure/workspace-notes-api");
      const coordinator = createCarryoverCoordinator(item);
      await coordinator.serialize(async (expectedVersion) => {
        const result = await workspaceNotesApi.updateChecklistItem(item.sourcePageId, item.itemId, { checked: true, expectedVersion });
        return { stateVersion: result.page.stateVersion, page: result.page };
      });
      await Promise.all([
        commands.queryClient.invalidateQueries({ queryKey: notesKeys.page(commands.organizationId, item.sourcePageId) }),
        commands.queryClient.invalidateQueries({ queryKey: notesKeys.checklistItems(commands.organizationId, item.sourcePageId) }),
        agendaDate ? commands.queryClient.invalidateQueries({ queryKey: notesKeys.carryover(commands.organizationId, agendaDate) }) : Promise.resolve(),
      ]);
      evictCarryoverCoordinator(item.sourcePageId);
    } catch (error) {
      setCarryoverError(isNoteVersionConflict(error) ? t("errors.versionConflict") : t("errors.generic"));
    } finally {
      setCarryoverPending(null);
    }
  }, [agendaDate, commands.organizationId, commands.queryClient, flush, t]);

  const serializePageCommand = useCallback(async (command: (expectedVersion: number) => Promise<NotePage>) => {
    const coordinator = coordinatorRef.current;
    if (!coordinator) return null;
    const result = await coordinator.serialize(command);
    replaceWithSnapshot(result);
    refreshSummaries();
    return result;
  }, [refreshSummaries, replaceWithSnapshot]);

  const changeVisibility = useCallback((visibility: NoteVisibility) => {
    if (!page) return;
    setVisibilityError(null);
    void serializePageCommand(async (expectedVersion) => {
      const { workspaceNotesApi } = await import("../../infrastructure/workspace-notes-api");
      return workspaceNotesApi.updatePage(page.id, { expectedVersion, visibility });
    }).catch(() => setVisibilityError(t("errors.generic")));
  }, [page, serializePageCommand, t]);

  const reloadServer = useCallback(async () => {
    if (!page) return;
    setConflictAction("reload");
    setConflictError(null);
    try {
      const { workspaceNotesApi } = await import("../../infrastructure/workspace-notes-api");
      const latest = await workspaceNotesApi.getPage(page.id);
      replaceWithSnapshot(latest);
      coordinatorRef.current?.resumeAtVersion(latest.stateVersion);
    } catch {
      setConflictError(t("conflict.retryError"));
    } finally {
      setConflictAction(null);
    }
  }, [page, replaceWithSnapshot, t]);

  const createPrivateCopy = useCallback(async () => {
    const local = autosave.localDraft ?? draftRef.current;
    if (!local) return;
    setConflictAction("copy");
    setConflictError(null);
    try {
      const copy = await commands.create.mutateAsync({ title: local.title, lexicalJson: cloneLexicalDocumentWithFreshChecklistIds(local.lexicalJson), visibility: "private", parentId: null });
      // The source coordinator is intentionally paused on the CAS conflict;
      // flushing it again would re-submit the stale draft and prevent the
      // private copy route from opening. The copy already contains the exact
      // preserved local snapshot, so navigate directly after creation.
      router.push(`/notes/${copy.id}`);
    } catch {
      setConflictError(t("conflict.retryError"));
    } finally {
      setConflictAction(null);
    }
  }, [autosave.localDraft, commands.create, router, t]);

  if (!dateIsValid) {
    return <div className="mx-auto max-w-3xl px-6 py-20 text-center"><CircleAlert className="mx-auto mb-3 size-6 text-destructive" /><h1 className="text-xl font-semibold">{t("agenda.invalidDate")}</h1></div>;
  }
  if (queryError) {
    const unavailable = queryError instanceof ApiError && queryError.status >= 400 && queryError.status < 500;
    return <div role="alert" className="mx-auto max-w-3xl px-6 py-20 text-center"><CircleAlert className="mx-auto mb-3 size-6 text-muted-foreground" /><h1 className="text-xl font-semibold">{unavailable ? t("errors.notFound") : t("errors.generic")}</h1>{!unavailable && <Button type="button" variant="outline" className="mt-4" onClick={() => { void (agendaDate ? agendaQuery.refetch() : pageQuery.refetch()); }}>{t("errors.retry")}</Button>}</div>;
  }
  if (isLoading || !page || !draft) {
    return <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("shell.loading")}</div>;
  }

  const breadcrumbs = breadcrumbSegments(tree.items, page.id);
  const memberNames = new Map(members.map((member) => [member.id, member.name || member.email]));
  const busy = autosave.status === "saving";
  const statusLabel = autosave.status === "conflict" ? t("errors.versionConflict") : t(`editor.${statusKey[autosave.status]}`);
  const dateLabel = page.dailyDate
    ? new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${page.dailyDate}T12:00:00`))
    : null;

  return (
    <article className="mx-auto min-h-full w-full max-w-5xl pb-24">
      {navigationError && <p role="alert" className="mx-5 mt-5 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive md:mx-10">{t("errors.navigationFlush")}</p>}
      <header className="px-5 pb-5 pt-8 md:px-10 md:pt-10">
        {page.kind === "daily" && page.dailyDate ? (
          <div className="mb-5 grid grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] items-center gap-1 sm:flex sm:justify-between sm:gap-3">
            <Button type="button" variant="ghost" size="sm" className="min-w-0 max-w-full justify-start whitespace-normal px-1 text-xs sm:px-3 sm:text-sm" onClick={() => { void navigateAfterFlush(`/notes/agenda/${shiftAgendaDate(page.dailyDate!, -1)}`).catch(() => undefined); }}><ChevronLeft className="size-4" />{t("agenda.previousDay")}</Button>
            <p className="min-w-0 max-w-[8rem] text-center text-xs font-medium capitalize text-muted-foreground sm:max-w-none sm:text-sm">{dateLabel}</p>
            <Button type="button" variant="ghost" size="sm" className="min-w-0 max-w-full justify-end whitespace-normal px-1 text-xs sm:px-3 sm:text-sm" onClick={() => { void navigateAfterFlush(`/notes/agenda/${shiftAgendaDate(page.dailyDate!, 1)}`).catch(() => undefined); }}>{t("agenda.nextDay")}<ChevronRight className="size-4" /></Button>
          </div>
        ) : breadcrumbs.length > 0 ? (
          <nav aria-label={t("page.breadcrumbs")} className="mb-5 flex min-w-0 max-w-full flex-wrap items-center gap-1 overflow-hidden text-xs text-muted-foreground">
            {breadcrumbs.map((crumb, index) => <span key={crumb.id} className="flex min-w-0 max-w-full items-center gap-1">{index > 0 && <ChevronRight className="size-3 shrink-0" />}{crumb.isCurrent ? <span aria-current="page" className="min-w-0 max-w-full truncate">{crumb.title}</span> : <Link href={`/notes/${crumb.id}`} className="min-w-0 max-w-full truncate hover:text-foreground hover:underline">{crumb.title}</Link>}</span>)}
          </nav>
        ) : null}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {page.canEdit ? (
              <>
                <h1 className="sr-only">{draft.title || t("editor.titlePlaceholder")}</h1>
                <Input
                  value={draft.title}
                  maxLength={500}
                  aria-label={t("editor.titlePlaceholder")}
                  aria-describedby="notes-title-remaining"
                  placeholder={t("editor.titlePlaceholder")}
                  onChange={(event) => queueDraft({ ...draftRef.current!, title: event.target.value })}
                  className="h-auto min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent px-0 py-1 text-3xl font-semibold tracking-tight shadow-none focus-visible:ring-0 md:text-4xl"
                />
                <p id="notes-title-remaining" className="mt-1 text-right text-[11px] text-muted-foreground">{t("editor.titleRemaining", { count: 500 - draft.title.length })}</p>
              </>
            ) : (
              <h1 className="min-w-0 max-w-full break-words text-3xl font-semibold tracking-tight md:text-4xl">{draft.title || t("editor.titlePlaceholder")}</h1>
            )}
            <p aria-live="polite" className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={autosave.status === "error" || autosave.status === "conflict" ? "text-destructive" : undefined}>{statusLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{t("page.updated", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(page.updatedAt)) })}</span>
              {autosave.status === "error" && <Button type="button" variant="ghost" size="xs" onClick={() => { void coordinatorRef.current?.flush(); }}><RotateCcw className="size-3" />{t("editor.retry")}</Button>}
            </p>
          </div>
          {(visibilityError || shareFlowError) && <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{visibilityError || shareFlowError}</p>}
          <NotePageActions
            page={page}
            disabled={busy || commands.archive.isPending || commands.reparent.isPending || sharePending}
            labels={{ actions: t("page.actions"), share: t("page.share"), move: t("page.move"), archive: t("page.archive"), visibility: t("page.visibility"), private: t("page.private"), workspace: t("page.workspace") }}
            onShare={() => setShareOpen(true)}
            onMove={() => setMoveOpen(true)}
            onArchive={() => setArchiveOpen(true)}
            onVisibility={changeVisibility}
          />
        </div>
        {childError && <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{childError}</p>}
        {page.kind === "page" && page.canCreateChild && (
          <Button type="button" variant="ghost" size="sm" className="mt-4" onClick={() => {
            if (commands.create.isPending) return;
            setChildError(null);
            void flush().then(() => commands.create.mutateAsync({ parentId: page.id, visibility: "private", title: t("editor.titlePlaceholder") })).then((created) => navigateAfterFlush(`/notes/${created.id}`)).catch(() => setChildError(t("errors.generic")));
          }} disabled={commands.create.isPending}><Plus className="size-4" />{commands.create.isPending ? t("common.loading") : t("page.createChild")}</Button>
        )}
      </header>

      {page.kind === "daily" && agendaDate && (
        <CarryoverList
          items={carryover.items}
          loading={carryover.isLoading || carryover.isFetchingNextPage}
          queryError={carryover.isError}
          onRetry={() => { void carryover.refetch(); }}
          pendingItemId={carryoverPending}
          error={carryoverError}
          onComplete={(item) => { void completeCarryover(item); }}
          labels={{ title: t("agenda.pendingTitle"), empty: t("agenda.pendingEmpty"), complete: t("agenda.complete"), from: t("agenda.from"), loading: t("common.loading"), retry: t("errors.retry"), unavailable: t("errors.generic") }}
        />
      )}

      {!page.canEdit && <p className="mx-5 mb-3 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground md:mx-10">{t("editor.readOnly")}</p>}
      {checklist.isError && <div role="alert" className="mx-5 mb-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{t("errors.generic")} <Button type="button" variant="ghost" size="xs" onClick={() => { void checklist.refetch(); }}>{t("errors.retry")}</Button></div>}
      <NotesEditor
        key={page.id}
        ref={editorRef}
        document={draft.lexicalJson}
        editable={page.canEdit && autosave.status !== "conflict"}
        availablePages={tree.items.filter((candidate) => candidate.id !== page.id)}
        checklistItems={checklist.items}
        memberNames={memberNames}
        labels={{
          formatting: t("editor.formatting"), paragraph: t("editor.paragraph"), heading1: t("editor.heading1"), heading2: t("editor.heading2"), bold: t("editor.bold"), italic: t("editor.italic"), underline: t("editor.underline"), strike: t("editor.strike"), inlineCode: t("editor.inlineCode"), bullet: t("editor.bullet"), number: t("editor.number"), checklist: t("editor.checklist"), quote: t("editor.quote"), code: t("editor.code"), link: t("editor.link"), internalLink: t("editor.internalLink"), slash: t("editor.slash"),
          bodyPlaceholder: t("editor.bodyPlaceholder"), linkPrompt: t("editor.linkPrompt"), invalidLink: t("editor.invalidLink"), pageLink: t("editor.pageLink"), saveLink: t("editor.saveLink"), untitled: t("editor.untitled"), cancel: t("common.cancel"),
          completion: (date, actor) => t("editor.completion", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(date)), actor }),
          memberFallback: t("editor.memberFallback"),
          updated: (date) => t("editor.updated", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(date)) }),
        }}
        onChange={(lexicalJson: LexicalJsonDocument) => queueDraft({ ...draftRef.current!, lexicalJson })}
        onChecklistToggle={updateChecklist}
      />

      <section aria-labelledby="notes-backlinks" className="mx-5 mt-8 border-t border-border px-0 py-6 md:mx-10">
        <h2 id="notes-backlinks" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("page.backlinks")}</h2>
        {backlinks.isError ? <p role="alert" className="mt-3 text-sm text-destructive">{t("errors.generic")} <Button type="button" variant="ghost" size="xs" onClick={() => { void backlinks.refetch(); }}>{t("errors.retry")}</Button></p> : backlinks.items.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{t("page.noBacklinks")}</p> : (
          <ul className="mt-3 space-y-2">{backlinks.items.map((link) => <li key={link.id}><Link href={`/notes/${link.sourcePageId}`} className="text-sm underline-offset-4 hover:underline">{link.sourceTitle}</Link>{link.anchorText && <span className="ml-2 text-xs text-muted-foreground">{link.anchorText}</span>}</li>)}</ul>
        )}
      </section>

      <MoveDialog
        open={moveOpen}
        currentPageId={page.id}
        pages={tree.items}
        labels={{ title: t("page.moveTitle"), description: t("page.moveDescription"), root: t("page.root"), move: t("page.move"), cancel: t("common.cancel") }}
        onOpenChange={setMoveOpen}
        pending={commands.reparent.isPending}
        error={moveError}
        onMove={(parentId) => {
          setMoveError(null);
          void serializePageCommand((expectedVersion) => commands.reparent.mutateAsync({ pageId: page.id, parentId, expectedVersion })).then(() => setMoveOpen(false)).catch(() => setMoveError(t("errors.generic")));
        }}
      />
      <ShareDialog
        open={shareOpen}
        members={members}
        membersError={membersQueryError ? t("errors.generic") : null}
        onRetryMembers={() => { void refetchMembers(); }}
        shares={shares.items}
        inheritedAccess={page.parentId !== null}
        labels={{ title: t("share.title"), description: t("share.description"), inherited: t("share.inherited"), member: t("share.member"), role: t("share.role"), viewer: t("share.viewer"), editor: t("share.editor"), save: t("share.save"), remove: t("share.remove"), close: t("share.close"), retryMembers: t("errors.retry") }}
        onOpenChange={setShareOpen}
        pending={sharePending}
        error={shares.isError || shareFlowError || commands.share.error || commands.removeShare.error ? t("errors.generic") : null}
        onSave={(userId, role) => { setShareFlowError(null); void flush().then(() => commands.share.mutateAsync({ pageId: page.id, userId, role })).catch(() => setShareFlowError(t("errors.generic"))); }}
        onRemove={(userId) => { setShareFlowError(null); void flush().then(() => commands.removeShare.mutateAsync({ pageId: page.id, userId })).catch(() => setShareFlowError(t("errors.generic"))); }}
      />
      <ConflictDialog
        open={autosave.status === "conflict"}
        localTitle={(autosave.localDraft ?? draft).title}
        labels={{ title: t("conflict.title"), description: t("conflict.description"), reload: t("conflict.reload"), createCopy: t("conflict.createCopy"), localDraft: t("conflict.localDraft") }}
        pending={conflictAction}
        error={conflictError}
        onReload={() => { void reloadServer(); }}
        onCreateCopy={() => { void createPrivateCopy(); }}
      />
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent data-notes-surface>
          <AlertDialogHeader><AlertDialogTitle>{t("page.archiveConfirm")}</AlertDialogTitle><AlertDialogDescription>{t("page.archiveDescription")}</AlertDialogDescription></AlertDialogHeader>
          {archiveError && <p role="alert" className="text-sm text-destructive">{archiveError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={commands.archive.isPending}>{t("common.cancel")}</AlertDialogCancel>
            <Button type="button" disabled={commands.archive.isPending} onClick={() => { setArchiveError(null); void serializePageCommand((expectedVersion) => commands.archive.mutateAsync({ pageId: page.id, expectedVersion })).then((archived) => { if (archived) { setArchiveOpen(false); return navigateAfterFlush("/notes/archive"); } }).catch(() => setArchiveError(t("errors.generic"))); }}>{commands.archive.isPending ? t("common.loading") : t("page.archive")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
};
