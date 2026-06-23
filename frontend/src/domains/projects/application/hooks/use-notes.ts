"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notesApi } from "@/lib/api/client";
import type {
  ProjectNote,
  CreateNoteRequest,
  UpdateNoteRequest,
} from "../../domain/types";
import { projectKeys } from "./use-projects";

export const noteKeys = {
  all: ["notes"] as const,
  lists: () => [...noteKeys.all, "list"] as const,
  list: (projectId: string) => [...noteKeys.lists(), projectId] as const,
  details: () => [...noteKeys.all, "detail"] as const,
  detail: (projectId: string, noteId: string) => [...noteKeys.details(), projectId, noteId] as const,
};

export const useNotes = (projectId: string) => {
  return useQuery({
    queryKey: noteKeys.list(projectId),
    queryFn: () => notesApi.list(projectId) as Promise<ProjectNote[]>,
    enabled: !!projectId,
  });
};

export const useNote = (projectId: string, noteId: string) => {
  return useQuery({
    queryKey: noteKeys.detail(projectId, noteId),
    queryFn: () => notesApi.get(projectId, noteId) as Promise<ProjectNote>,
    enabled: !!projectId && !!noteId,
  });
};

export const useCreateNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, data }: { projectId: string; data: CreateNoteRequest }) =>
      notesApi.create(projectId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: noteKeys.list(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detailBatch(variables.projectId) });
    },
  });
};

export const useUpdateNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, noteId, data }: { projectId: string; noteId: string; data: UpdateNoteRequest }) =>
      notesApi.update(projectId, noteId, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: noteKeys.list(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: noteKeys.detail(variables.projectId, variables.noteId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detailBatch(variables.projectId) });
    },
  });
};

export const useDeleteNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, noteId }: { projectId: string; noteId: string }) =>
      notesApi.delete(projectId, noteId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: noteKeys.list(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detailBatch(variables.projectId) });
    },
  });
};

export const useReorderNotes = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, noteIds }: { projectId: string; noteIds: string[] }) =>
      notesApi.reorder(projectId, noteIds),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: noteKeys.list(variables.projectId) });
    },
  });
};
