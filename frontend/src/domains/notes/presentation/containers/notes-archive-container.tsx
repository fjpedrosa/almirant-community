"use client";

import { Archive, CircleAlert, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useArchivedPages, useLegacyArchive, useNotesCommands } from "../../application/use-notes";
import { notesKeys } from "../../domain/query-keys";
import { workspaceNotesApi } from "../../infrastructure/workspace-notes-api";
import { NotesArchivePanel } from "../components/notes-archive-panel";
import { useNotesShellRegistration } from "./notes-shell-context";

export const NotesArchiveContainer = () => {
  const t = useTranslations("notes");
  const router = useRouter();
  const archived = useArchivedPages();
  const legacy = useLegacyArchive("all");
  const commands = useNotesCommands();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const actionIds = useRef(new Map<string, string>());
  useNotesShellRegistration({ activePageId: null, selectedDate: null });

  const actionId = (operation: "convert" | "discard", archiveId: string) => {
    const key = `${operation}:${archiveId}`;
    const existing = actionIds.current.get(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    actionIds.current.set(key, created);
    return created;
  };

  const refreshLegacy = () => commands.queryClient.invalidateQueries({ queryKey: notesKeys.legacy(commands.organizationId, "all") });

  const convert = async (archiveId: string) => {
    setPendingId(archiveId);
    setError(false);
    try {
      const result = await workspaceNotesApi.convertLegacy(archiveId, { actionId: actionId("convert", archiveId) });
      await refreshLegacy();
      if (result.convertedPageId) router.push(`/notes/${result.convertedPageId}`);
    } catch {
      setError(true);
    } finally {
      setPendingId(null);
    }
  };

  const discard = async (archiveId: string) => {
    setPendingId(archiveId);
    setError(false);
    try {
      await workspaceNotesApi.discardLegacy(archiveId, { actionId: actionId("discard", archiveId) });
      await refreshLegacy();
    } catch {
      setError(true);
    } finally {
      setPendingId(null);
    }
  };

  const loading = archived.isLoading || legacy.isLoading;
  const failed = archived.isError || legacy.isError;
  return (
    <main className="mx-auto min-h-full w-full max-w-5xl px-5 pb-24 pt-10 md:px-10">
      <header className="mb-10 max-w-2xl">
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted"><Archive className="size-5 text-muted-foreground" /></div>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("archive.title")}</h1>
        <p className="mt-2 leading-7 text-muted-foreground">{t("archive.description")}</p>
      </header>
      {loading ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("common.loading")}</div>
      ) : failed ? (
        <div className="flex items-center gap-3 border-y border-border py-8 text-sm text-muted-foreground">
          <CircleAlert className="size-5" />{t("errors.generic")}
          <Button type="button" variant="outline" size="sm" onClick={() => { void archived.refetch(); void legacy.refetch(); }}>{t("errors.retry")}</Button>
        </div>
      ) : (
        <>
          {error && <p role="alert" className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{t("errors.generic")}</p>}
          <NotesArchivePanel
            archivedPages={archived.items}
            legacyItems={legacy.items}
            pendingId={pendingId}
            hasMoreArchived={Boolean(archived.hasNextPage)}
            hasMoreLegacy={Boolean(legacy.hasNextPage)}
            onLoadMoreArchived={() => { void archived.fetchNextPage(); }}
            onLoadMoreLegacy={() => { void legacy.fetchNextPage(); }}
            onRestore={(pageId, expectedVersion) => {
              setPendingId(pageId);
              void commands.restore.mutateAsync({ pageId, expectedVersion }).then((restored) => router.push(`/notes/${restored.id}`)).catch(() => setError(true)).finally(() => setPendingId(null));
            }}
            onConvert={(archiveId) => { void convert(archiveId); }}
            onDiscard={(archiveId) => discard(archiveId)}
            labels={{
              pages: t("archive.pages"), legacy: t("archive.legacy"), emptyPages: t("archive.emptyPages"), emptyLegacy: t("archive.emptyLegacy"), restore: t("archive.restore"), convert: t("archive.convert"), converted: t("archive.converted"), discard: t("archive.discard"), discardTitle: t("archive.discardTitle"), discardDescription: t("archive.discardDescription"), confirmDiscard: t("archive.confirmDiscard"), cancel: t("common.cancel"), pending: t("archive.pending"), convertedStatus: t("archive.convertedStatus"), discardedStatus: t("archive.discardedStatus"), loadMore: t("archive.loadMore"), sourceTodo: t("archive.sourceTodo"), sourceIdea: t("archive.sourceIdea"), sourceSeed: t("archive.sourceSeed"),
            }}
          />
        </>
      )}
    </main>
  );
};
