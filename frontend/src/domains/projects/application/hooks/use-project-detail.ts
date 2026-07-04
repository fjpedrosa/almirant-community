"use client";

import { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useArchiveProject, projectKeys } from "./use-projects";
import { useCreateDocLink, useDeleteDocLink } from "./use-doc-links";
import { useCreateRepository, useDeleteRepository } from "./use-repositories";
import { useCreateNote, useUpdateNote, useDeleteNote } from "./use-notes";
import { useProjectScreenshot } from "./use-project-screenshot";
import { useGithubInstallations } from "@/domains/github/application/hooks/use-github-connection";
import { useGithubInstallationRepos } from "@/domains/github/application/hooks/use-github-installation-repos";
import { projectsApi } from "@/lib/api/client";
import type { DocLinkType, RepositoryProvider, ProjectBoardItem, ProjectDocLink, ProjectNote, ProjectRepository, GithubRepoOption } from "../../domain/types";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";

export const docLinkIcons: Record<DocLinkType, string> = {
  notion: "N",
  github: "GH",
  gdocs: "G",
  confluence: "C",
  figma: "F",
  other: "\uD83D\uDD17",
};

export const useProjectDetail = (
  projectId: string,
  isReposTabActive = false,
) => {
  const router = useRouter();

  // Single batch query replaces 5 individual queries
  const { data: batchData, isLoading } = useQuery({
    queryKey: projectKeys.detailBatch(projectId),
    queryFn: () => projectsApi.getDetail(projectId),
    enabled: !!projectId,
  });

  const project = batchData?.project ?? undefined;
  const boards = batchData?.boards;
  const docLinks = batchData?.docLinks;
  const repositories = batchData?.repositories;
  const notes = batchData?.notes;
  const archiveProject = useArchiveProject();
  const createDocLink = useCreateDocLink();
  const deleteDocLink = useDeleteDocLink();
  const createRepo = useCreateRepository();
  const deleteRepo = useDeleteRepository();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();

  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const screenshot = useProjectScreenshot(
    projectId,
    project?.screenshotUrl ?? null,
    project?.productionUrl ?? null
  );

  const handleOpenEdit = useCallback(() => setEditDialogOpen(true), []);
  const handleCloseEdit = useCallback(() => setEditDialogOpen(false), []);
  const handleEditDialogChange = useCallback((open: boolean) => setEditDialogOpen(open), []);

  const [newLinkTitle, setNewLinkTitle] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkType, setNewLinkType] = useState<DocLinkType>("other");
  const [newRepoName, setNewRepoName] = useState("");
  const [newRepoUrl, setNewRepoUrl] = useState("");
  const [newRepoProvider, setNewRepoProvider] = useState<RepositoryProvider>("github");
  const [newRepoIsMonorepo, setNewRepoIsMonorepo] = useState(false);
  const [githubRepoSearchQuery, setGithubRepoSearchQuery] = useState("");
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [noteContent, setNoteContent] = useState("");

  const selectedNote = useMemo(
    () => notes?.find((n: { id: string }) => n.id === selectedNoteId),
    [notes, selectedNoteId]
  );

  const progress = useMemo(
    () =>
      project && project.workItemsCount > 0
        ? Math.round((project.completedItemsCount / project.workItemsCount) * 100)
        : 0,
    [project]
  );

  const typedBoards: ProjectBoardItem[] = useMemo(
    () => (boards as ProjectBoardItem[]) || [],
    [boards]
  );

  const typedDocLinks: ProjectDocLink[] = useMemo(
    () => (docLinks as ProjectDocLink[]) || [],
    [docLinks]
  );

  const typedRepositories: ProjectRepository[] = useMemo(
    () => (repositories as ProjectRepository[]) || [],
    [repositories]
  );

  const typedNotes: ProjectNote[] = useMemo(
    () => (notes as ProjectNote[]) || [],
    [notes]
  );

  // GitHub installation repos
  const { data: installations } = useGithubInstallations();

  const activeInstallationId = useMemo(() => {
    if (!installations || installations.length === 0) return null;
    return installations[0].installationId;
  }, [installations]);

  const isGithubConnected = !!activeInstallationId;

  // Only walk the whole installation's repo pages when the Repos tab is open.
  // Otherwise this paginated fetch fires on every project-detail mount.
  const { data: githubReposRaw, isLoading: isLoadingGithubRepos } =
    useGithubInstallationRepos(activeInstallationId, {
      enabled: isReposTabActive,
    });

  const { data: linkedGithubUrls } = useQuery({
    queryKey: projectKeys.linkedGithubUrls(),
    queryFn: () => projectsApi.getLinkedGithubUrls(),
    enabled: isGithubConnected && isReposTabActive,
    staleTime: 30_000,
  });

  const githubRepos: GithubRepoOption[] = useMemo(() => {
    if (!githubReposRaw) return [];
    const linkedSet = new Set(linkedGithubUrls ?? []);
    return githubReposRaw
      .filter((r) => !linkedSet.has(r.html_url))
      .map((r) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        description: r.description,
        htmlUrl: r.html_url,
        isPrivate: r.private,
        language: r.language,
        defaultBranch: r.default_branch,
      }));
  }, [githubReposRaw, linkedGithubUrls]);

  const handleGithubRepoSelect = useCallback(
    (repo: GithubRepoOption) => {
      setNewRepoName(repo.name);
      setNewRepoUrl(repo.htmlUrl);
      setNewRepoProvider("github");
      setGithubRepoSearchQuery("");
    },
    []
  );

  const handleArchiveProject = useCallback(async () => {
    try {
      await archiveProject.mutateAsync(projectId);
      router.push("/projects");
      showToast.success("Proyecto archivado");
    } catch {
      showToast.error("Error al archivar");
    }
  }, [archiveProject, projectId, router]);

  const handleAddLink = useCallback(async () => {
    if (!newLinkTitle.trim() || !newLinkUrl.trim()) return;
    try {
      await createDocLink.mutateAsync({
        projectId,
        data: { title: newLinkTitle, url: newLinkUrl, type: newLinkType },
      });
      setNewLinkTitle("");
      setNewLinkUrl("");
      setNewLinkType("other");
      showToast.success("Link a\u00F1adido");
    } catch {
      showToast.error("Error al a\u00F1adir link");
    }
  }, [newLinkTitle, newLinkUrl, newLinkType, createDocLink, projectId]);

  const handleDeleteLink = useCallback(
    (linkId: string) => {
      deleteDocLink.mutate({ projectId, linkId });
      showToast.success("Link eliminado");
    },
    [deleteDocLink, projectId]
  );

  const handleAddRepo = useCallback(async () => {
    if (!newRepoName.trim() || !newRepoUrl.trim()) return;
    try {
      await createRepo.mutateAsync({
        projectId,
        data: { name: newRepoName, url: newRepoUrl, provider: newRepoProvider, isMonorepo: newRepoIsMonorepo },
      });
      setNewRepoName("");
      setNewRepoUrl("");
      setNewRepoProvider("github");
      setNewRepoIsMonorepo(false);
      showToast.success("Repositorio añadido");
    } catch {
      showToast.error("Error al añadir repositorio");
    }
  }, [newRepoName, newRepoUrl, newRepoProvider, newRepoIsMonorepo, createRepo, projectId]);

  const handleDeleteRepo = useCallback(
    (repoId: string) => {
      deleteRepo.mutate({ projectId, repoId });
      showToast.success("Repositorio eliminado");
    },
    [deleteRepo, projectId]
  );

  const handleAddNote = useCallback(async () => {
    if (!newNoteTitle.trim()) return;
    try {
      await createNote.mutateAsync({
        projectId,
        data: { title: newNoteTitle, content: "" },
      });
      setNewNoteTitle("");
      showToast.success("Nota creada");
    } catch {
      showToast.error("Error al crear nota");
    }
  }, [newNoteTitle, createNote, projectId]);

  const handleSelectNote = useCallback((noteId: string, content: string) => {
    setSelectedNoteId(noteId);
    setNoteContent(content);
  }, []);

  const handleSaveNote = useCallback(async () => {
    if (!selectedNoteId) return;
    try {
      await updateNote.mutateAsync({
        projectId,
        noteId: selectedNoteId,
        data: { content: noteContent },
      });
      showToast.success("Nota guardada");
    } catch {
      showToast.error("Error al guardar nota");
    }
  }, [selectedNoteId, noteContent, updateNote, projectId]);

  const handleDeleteNote = useCallback(
    (noteId: string) => {
      deleteNote.mutate({ projectId, noteId });
      if (selectedNoteId === noteId) {
        setSelectedNoteId(null);
        setNoteContent("");
      }
      showToast.success("Nota eliminada");
    },
    [deleteNote, projectId, selectedNoteId]
  );

  const handleBack = useCallback(() => {
    router.push("/projects");
  }, [router]);

  return {
    project,
    isLoading,
    boards: typedBoards,
    docLinks: typedDocLinks,
    repositories: typedRepositories,
    notes: typedNotes,
    progress,
    selectedNote,
    selectedNoteId,
    noteContent,
    newLinkTitle,
    newLinkUrl,
    newLinkType,
    newRepoName,
    newRepoUrl,
    newRepoProvider,
    newRepoIsMonorepo,
    newNoteTitle,
    editDialogOpen,
    screenshot,
    setNewLinkTitle,
    setNewLinkUrl,
    setNewLinkType,
    setNewRepoName,
    setNewRepoUrl,
    setNewRepoProvider,
    setNewRepoIsMonorepo,
    setNewNoteTitle,
    setNoteContent,
    handleArchiveProject,
    handleAddLink,
    handleDeleteLink,
    handleAddRepo,
    handleDeleteRepo,
    handleAddNote,
    handleSelectNote,
    handleSaveNote,
    handleDeleteNote,
    handleBack,
    handleOpenEdit,
    handleCloseEdit,
    handleEditDialogChange,
    isAddingLink: createDocLink.isPending,
    isAddingRepo: createRepo.isPending,
    isCreatingNote: createNote.isPending,
    isSavingNote: updateNote.isPending,
    // GitHub repo selector
    githubRepos,
    isLoadingGithubRepos,
    githubRepoSearchQuery,
    setGithubRepoSearchQuery,
    handleGithubRepoSelect,
    isGithubConnected,
  };
};
