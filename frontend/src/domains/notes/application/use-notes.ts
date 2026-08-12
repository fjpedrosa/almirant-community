"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { ApiError } from "@/lib/api/client";
import { workspaceNotesApi } from "../infrastructure/workspace-notes-api";
import { notesKeys } from "../domain/query-keys";
import { buildNoteTree, mergeNoteCollections } from "../domain/tree";
import type {
  CreateNotePageInput,
  NoteLegacyDispositionFilter,
  NotePage,
  NotePageSummary,
  NoteShareRole,
} from "../domain/types";

const orgToken = (organizationId: string | null | undefined) => `org:${organizationId ?? "none"}`;

const useConsumeAllPages = ({
  hasNextPage,
  isFetchingNextPage,
  isError,
  fetchNextPage,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isError: boolean;
  fetchNextPage: () => Promise<unknown>;
}) => {
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isError, isFetchingNextPage]);
};

export const invalidateNotesCollections = async (
  queryClient: QueryClient,
  organizationId: string | null | undefined,
) => queryClient.invalidateQueries({
  predicate: (query) => query.queryKey[0] === "notes"
    && query.queryKey[1] !== "page"
    && query.queryKey.includes(orgToken(organizationId)),
});

export const useNotesTree = () => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const query = useInfiniteQuery({
    queryKey: notesKeys.tree(confirmedActiveTeamId),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workspaceNotesApi.listPages({ limit: 100, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.pagination.nextOffset ?? undefined,
    enabled: Boolean(confirmedActiveTeamId),
  });
  useConsumeAllPages(query);
  const items = useMemo(() => mergeNoteCollections(query.data?.pages ?? []), [query.data?.pages]);
  const tree = useMemo(() => buildNoteTree(items), [items]);
  return { ...query, organizationId: confirmedActiveTeamId, items: query.isError ? [] : items, tree: query.isError ? [] : tree };
};

export const useNotePage = (pageId: string | null | undefined) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  return useQuery({
    queryKey: notesKeys.page(confirmedActiveTeamId, pageId ?? "none"),
    queryFn: () => workspaceNotesApi.getPage(pageId!),
    enabled: Boolean(confirmedActiveTeamId && pageId),
    retry: (failureCount, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 3,
  });
};

export const useAgendaDay = (date: string, enabled = true) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  return useQuery({
    queryKey: notesKeys.agendaDay(confirmedActiveTeamId, date),
    queryFn: () => workspaceNotesApi.getOrCreateAgendaDay(date),
    enabled: Boolean(confirmedActiveTeamId && enabled),
    staleTime: 60_000,
  });
};

export const useAgendaMonth = (month: string, enabled = true) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const query = useInfiniteQuery({
    queryKey: notesKeys.agendaMonth(confirmedActiveTeamId, month),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workspaceNotesApi.listAgendaMonth(month, { limit: 100, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.pagination.nextOffset ?? undefined,
    enabled: Boolean(confirmedActiveTeamId && enabled),
  });
  useConsumeAllPages(query);
  return { ...query, items: query.isError ? [] : mergeNoteCollections(query.data?.pages ?? []) };
};

export const useCarryover = (date: string, enabled = true) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const query = useInfiniteQuery({
    queryKey: notesKeys.carryover(confirmedActiveTeamId, date),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workspaceNotesApi.listCarryover(date, { limit: 100, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.pagination.nextOffset ?? undefined,
    enabled: Boolean(confirmedActiveTeamId && enabled),
  });
  useConsumeAllPages(query);
  return { ...query, items: query.isError ? [] : query.data?.pages.flatMap((page) => page.items) ?? [] };
};

export const useChecklistItems = (pageId: string | null | undefined) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const query = useInfiniteQuery({
    queryKey: notesKeys.checklistItems(confirmedActiveTeamId, pageId ?? "none"),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workspaceNotesApi.listChecklistItems(pageId!, { limit: 100, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.pagination.nextOffset ?? undefined,
    enabled: Boolean(confirmedActiveTeamId && pageId),
  });
  useConsumeAllPages(query);
  return { ...query, items: query.isError ? [] : query.data?.pages.flatMap((page) => page.items) ?? [] };
};

export const useBacklinks = (pageId: string | null | undefined) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const query = useInfiniteQuery({
    queryKey: notesKeys.backlinks(confirmedActiveTeamId, pageId ?? "none"),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workspaceNotesApi.listBacklinks(pageId!, { limit: 100, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.pagination.nextOffset ?? undefined,
    enabled: Boolean(confirmedActiveTeamId && pageId),
  });
  useConsumeAllPages(query);
  return { ...query, items: query.isError ? [] : query.data?.pages.flatMap((page) => page.items) ?? [] };
};

export const useShares = (pageId: string | null | undefined, enabled: boolean) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const query = useInfiniteQuery({
    queryKey: notesKeys.shares(confirmedActiveTeamId, pageId ?? "none"),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workspaceNotesApi.listShares(pageId!, { limit: 100, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.pagination.nextOffset ?? undefined,
    enabled: Boolean(confirmedActiveTeamId && pageId && enabled),
  });
  useConsumeAllPages(query);
  return { ...query, items: query.isError ? [] : query.data?.pages.flatMap((page) => page.items) ?? [] };
};

export const useArchivedPages = () => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const query = useInfiniteQuery({
    queryKey: notesKeys.archived(confirmedActiveTeamId),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workspaceNotesApi.listArchivedPages({ limit: 50, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.pagination.nextOffset ?? undefined,
    enabled: Boolean(confirmedActiveTeamId),
  });
  return { ...query, organizationId: confirmedActiveTeamId, items: query.isError ? [] : query.data?.pages.flatMap((page) => page.items) ?? [] };
};

export const useLegacyArchive = (disposition: NoteLegacyDispositionFilter = "all") => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const query = useInfiniteQuery({
    queryKey: notesKeys.legacy(confirmedActiveTeamId, disposition),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => workspaceNotesApi.listLegacy(disposition, { limit: 50, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.pagination.nextOffset ?? undefined,
    enabled: Boolean(confirmedActiveTeamId),
  });
  return { ...query, organizationId: confirmedActiveTeamId, items: query.isError ? [] : query.data?.pages.flatMap((page) => page.items) ?? [] };
};

export const useNotesSearch = (search: string) => {
  const { confirmedActiveTeamId } = useActiveTeam();
  const normalized = search.trim();
  return useQuery({
    queryKey: notesKeys.search(confirmedActiveTeamId, normalized),
    queryFn: () => workspaceNotesApi.search(normalized, { limit: 50, offset: 0 }),
    enabled: Boolean(confirmedActiveTeamId && normalized),
  });
};

export const useNotesCommands = () => {
  const queryClient = useQueryClient();
  const { confirmedActiveTeamId } = useActiveTeam();
  const settle = (page?: NotePage) => {
    if (page) queryClient.setQueryData(notesKeys.page(confirmedActiveTeamId, page.id), page);
    void invalidateNotesCollections(queryClient, confirmedActiveTeamId);
  };
  const create = useMutation({
    mutationFn: (input: CreateNotePageInput) => workspaceNotesApi.createPage(input),
    onSuccess: settle,
  });
  const restore = useMutation({
    mutationFn: ({ pageId, expectedVersion }: { pageId: string; expectedVersion: number }) => workspaceNotesApi.restorePage(pageId, expectedVersion),
    onSuccess: settle,
  });
  const archive = useMutation({
    mutationFn: ({ pageId, expectedVersion }: { pageId: string; expectedVersion: number }) => workspaceNotesApi.archivePage(pageId, expectedVersion),
    onSuccess: settle,
  });
  const reparent = useMutation({
    mutationFn: ({ pageId, parentId, expectedVersion }: { pageId: string; parentId: string | null; expectedVersion: number }) => workspaceNotesApi.reparentPage(pageId, { parentId, expectedVersion }),
    onSuccess: settle,
  });
  const share = useMutation({
    mutationFn: ({ pageId, userId, role }: { pageId: string; userId: string; role: NoteShareRole }) => workspaceNotesApi.upsertShare(pageId, userId, role),
    onSuccess: () => { void invalidateNotesCollections(queryClient, confirmedActiveTeamId); },
  });
  const removeShare = useMutation({
    mutationFn: ({ pageId, userId }: { pageId: string; userId: string }) => workspaceNotesApi.removeShare(pageId, userId),
    onSuccess: () => { void invalidateNotesCollections(queryClient, confirmedActiveTeamId); },
  });
  return { organizationId: confirmedActiveTeamId, queryClient, create, restore, archive, reparent, share, removeShare, settle };
};

export const summaryFromPage = (page: NotePage): NotePageSummary => ({
  id: page.id,
  ownerUserId: page.ownerUserId,
  parentId: page.parentId,
  kind: page.kind,
  dailyDate: page.dailyDate,
  visibility: page.visibility,
  title: page.title,
  position: page.position,
  stateVersion: page.stateVersion,
  createdAt: page.createdAt,
  updatedAt: page.updatedAt,
  canEdit: page.canEdit,
  canCreateChild: page.canCreateChild,
  canManageShares: page.canManageShares,
  canReparent: page.canReparent,
  canArchive: page.canArchive,
  canChangeVisibility: page.canChangeVisibility,
  canRestore: page.canRestore,
});
