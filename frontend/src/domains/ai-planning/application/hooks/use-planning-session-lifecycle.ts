'use client';

import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showToast } from '@/domains/shared/presentation/utils/show-toast';

// ---------------------------------------------------------------------------
// Read URL search params without useSearchParams() to avoid Suspense.
// useSearchParams triggers Suspense boundaries in Next.js App Router,
// which can cause the parent tree to unmount/remount on Vercel when the
// server layout re-renders — destroying all useReducer state.
// ---------------------------------------------------------------------------
const getSearchParams = () =>
  typeof window !== "undefined" ? window.location.search : "";

// Custom event fired after history.replaceState so useSyncExternalStore
// picks up URL changes immediately (replaceState doesn't fire popstate).
const URL_CHANGE_EVENT = "almirant:url-change";
const subscribeToUrl = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  window.addEventListener(URL_CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(URL_CHANGE_EVENT, cb);
  };
};
const useUrlSearchParams = () => {
  const search = useSyncExternalStore(subscribeToUrl, getSearchParams, () => "");
  return new URLSearchParams(search);
};
const useUrlPathname = () => {
  const pathname = useSyncExternalStore(
    subscribeToUrl,
    () => window.location.pathname,
    () => "/",
  );
  return pathname;
};
import type { UsePlanningSessionReturn } from '@/domains/planning/application/hooks/use-planning-session';
import type { SeedWithRelations } from '@/domains/planning/domain/types';
import { planningSessionKeys } from '@/domains/planning/domain/query-keys';
import { planningSessionsApi } from '@/domains/planning/infrastructure/api/planning-api';
import { buildSeedContextPrefix } from '../utils/build-seed-context';
import type { SeedImportResult } from '../../domain/types';
import type { useProjectBoardSelector } from './use-project-board-selector';
import type { useSessionSidebar } from './use-session-sidebar';
import type { useWorkItemGeneration } from './use-work-item-generation';

export const shouldLoadPlanningSessionFromUrl = ({
  urlSessionId,
  currentSessionId,
  lastRequestedUrlSessionId,
  isLoadingFromUrl,
}: {
  urlSessionId: string | null;
  currentSessionId: string | null;
  lastRequestedUrlSessionId: string | null;
  isLoadingFromUrl: boolean;
}) => {
  if (!urlSessionId || isLoadingFromUrl) return false;
  if (urlSessionId === currentSessionId) return false;
  if (urlSessionId === lastRequestedUrlSessionId) return false;
  return true;
};

// ---------------------------------------------------------------------------
// Hook: usePlanningSessionLifecycle
// ---------------------------------------------------------------------------
// Manages session creation, loading, resuming, and seed context injection.
// Extracted from usePlanChatPage to keep the orchestrator lightweight.
// ---------------------------------------------------------------------------

export const usePlanningSessionLifecycle = (
  planningSession: UsePlanningSessionReturn,
  projectBoard: ReturnType<typeof useProjectBoardSelector>,
  sidebar: ReturnType<typeof useSessionSidebar>,
  generation: ReturnType<typeof useWorkItemGeneration>,
  /** Optional callback returning the current agent config for prewarm requests. */
  getAgentConfig?: () => { provider?: string; codingAgent?: string; model?: string } | undefined,
) => {
  // ----- State for seed context & pending seeds (replaced refs per DoD) -----
  const sessionIdRef = useRef<string | null>(null);
  const [seedContextPrefix, setSeedContextPrefix] = useState<string | null>(
    null,
  );
  const [hasInjectedSeeds, setHasInjectedSeeds] = useState(false);
  const [pendingSeedIds, setPendingSeedIds] = useState<string[]>([]);
  const [submittedSeedIds, setSubmittedSeedIds] = useState<Set<string>>(
    new Set(),
  );
  const [seedsAutoCollapsed, setSeedsAutoCollapsed] = useState(false);

  // ----- State for URL session loading (triggers skeleton) -----
  const [isLoadingFromUrl, setIsLoadingFromUrl] = useState(false);

  // ----- State for conflict dialog (replaces window.confirm) -----
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictResumeSessionId, setConflictResumeSessionId] = useState<
    string | null
  >(null);

  const queryClient = useQueryClient();
  const searchParams = useUrlSearchParams();
  const pathname = useUrlPathname();
  const loadPlanningSessionFromState = planningSession.loadSession;
  const notifySidebarSessionClick = sidebar.onSessionClick;

  // --- URL ↔ sessionId sync ---
  /** True while we're loading a session from the URL param (prevents sync effect from clearing it). */
  const loadingFromUrlRef = useRef(false);

  const updateUrlSessionId = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) {
        params.set("sessionId", id);
      } else {
        params.delete("sessionId");
      }
      const qs = params.toString();
      // Use history.replaceState instead of router.replace to avoid
      // triggering a Suspense re-mount that destroys useReducer state.
      // router.replace causes useSearchParams to re-suspend, which
      // unmounts the entire PlanChatPageContainer inside <Suspense>.
      const newUrl = `${pathname}${qs ? `?${qs}` : ""}`;
      window.history.replaceState(window.history.state, "", newUrl);
      // Notify useSyncExternalStore subscribers so they pick up the change
      // immediately (replaceState doesn't fire popstate).
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
    },
    [searchParams, pathname],
  );

  // Track the latest URL session hydration request to avoid duplicate loads
  // while still reacting when the URL points to a different session later.
  const lastRequestedUrlSessionIdRef = useRef<string | null>(null);
  const urlSessionId = searchParams.get("sessionId");

  useEffect(() => {
    if (!urlSessionId) {
      lastRequestedUrlSessionIdRef.current = null;
      return;
    }
    if (!shouldLoadPlanningSessionFromUrl({
      urlSessionId,
      currentSessionId: planningSession.sessionId,
      lastRequestedUrlSessionId: lastRequestedUrlSessionIdRef.current,
      isLoadingFromUrl: loadingFromUrlRef.current,
    })) {
      if (urlSessionId === planningSession.sessionId) {
        lastRequestedUrlSessionIdRef.current = urlSessionId;
      }
      return;
    }

    lastRequestedUrlSessionIdRef.current = urlSessionId;
    loadingFromUrlRef.current = true;
    setIsLoadingFromUrl(true);
    void loadPlanningSessionFromState(urlSessionId)
      .then(() => {
        setShowChatPanel(true);
        notifySidebarSessionClick(urlSessionId);
      })
      .catch(() => {
        lastRequestedUrlSessionIdRef.current = null;
        updateUrlSessionId(null);
      })
      .finally(() => {
        loadingFromUrlRef.current = false;
        setIsLoadingFromUrl(false);
      });
  }, [
    urlSessionId,
    planningSession.sessionId,
    loadPlanningSessionFromState,
    notifySidebarSessionClick,
    updateUrlSessionId,
  ]);

  // When sessionId changes in state, sync to URL (skip while loading from URL)
  useEffect(() => {
    if (loadingFromUrlRef.current) return;
    const currentUrlSessionId = searchParams.get("sessionId");
    const stateSessionId = planningSession.sessionId;
    if (stateSessionId !== currentUrlSessionId) {
      updateUrlSessionId(stateSessionId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planningSession.sessionId]);

  // Track whether a prewarm request was sent for the current session
  const prewarmSentRef = useRef(false);

  // Synchronous lock to prevent rapid double-clicks on "Start session"
  // React state updates are batched, so two quick clicks can both see isStarting=false
  // before the first setIsStarting(true) takes effect. A ref provides immediate sync lock.
  const startingLockRef = useRef(false);

  // Track whether seeds have been marked as to_review for the current session
  const seedsMarkedAsToReviewRef = useRef<string | null>(null);

  // Keep sessionIdRef in sync
  useEffect(() => {
    sessionIdRef.current = planningSession.sessionId;
  }, [planningSession.sessionId]);

  // ----- React Query: attached seeds -----
  const { data: attachedSeeds = [] } = useQuery({
    queryKey: planningSessionKeys.seeds(planningSession.sessionId ?? ''),
    queryFn: () => planningSessionsApi.getSeeds(planningSession.sessionId!),
    enabled: !!planningSession.sessionId,
  });

  // ----- Seed management -----
  const handleRemoveSeed = useCallback(
    async (seedId: string) => {
      const currentSessionId = sessionIdRef.current;
      if (!currentSessionId) return;
      try {
        await planningSessionsApi.removeSeed(currentSessionId, seedId);
        await queryClient.invalidateQueries({
          queryKey: planningSessionKeys.seeds(currentSessionId),
        });
        const remaining = attachedSeeds.filter((s) => s.id !== seedId);
        if (remaining.length > 0) {
          setSeedContextPrefix(buildSeedContextPrefix(remaining));
        } else {
          setSeedContextPrefix(null);
        }
        setHasInjectedSeeds(false);
      } catch (e) {
        console.error('Failed to remove seed:', e);
      }
    },
    [queryClient, attachedSeeds],
  );

  const persistSeedsToSession = useCallback(
    async (sessionId: string, seedIds: string[]) => {
      if (seedIds.length === 0) return;
      await Promise.allSettled(
        seedIds.map((seedId) => planningSessionsApi.addSeed(sessionId, seedId)),
      );
    },
    [],
  );

  const handleSeedImportComplete = useCallback(
    (result: SeedImportResult) => {
      if (result.contextPrefix) {
        setSeedContextPrefix(result.contextPrefix);
        setHasInjectedSeeds(false);
      }

      const seedIds = result.seeds.map((s) => s.id);
      const currentSessionId = sessionIdRef.current;

      if (currentSessionId) {
        void persistSeedsToSession(currentSessionId, seedIds).then(() => {
          void queryClient.invalidateQueries({
            queryKey: planningSessionKeys.seeds(currentSessionId),
          });
        });
        setPendingSeedIds([]);
      } else {
        setPendingSeedIds(seedIds);
      }
    },
    [persistSeedsToSession, queryClient],
  );

  // ----- UI state -----
  const [isStarting, setIsStarting] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(false);

  // ----- Derived -----
  const isSessionActive = planningSession.session?.status === 'active';

  // ----- Session click (load for read-only replay) -----
  const handleSidebarSessionClick = useCallback(
    async (id: string) => {
      sidebar.onSessionClick(id);
      try {
        await planningSession.loadSession(id);
        sessionIdRef.current = id;

        // Hydrate seeds from the junction table
        try {
          const seeds: SeedWithRelations[] =
            await planningSessionsApi.getSeeds(id);
          if (seeds.length > 0) {
            setSeedContextPrefix(buildSeedContextPrefix(seeds));
            setHasInjectedSeeds(false);
          }
        } catch {
          // Seed hydration is best-effort
        }
      } catch {
        // Error handled by usePlanningSession reducer
      }
    },
    [sidebar, planningSession],
  );

  // ----- Session resume -----
  const handleSidebarSessionResume = useCallback(
    async (id: string) => {
      try {
        const resumed = await planningSession.resumeSession(id);
        sidebar.onSessionClick(id);
        sessionIdRef.current = resumed.id;

        try {
          const seeds: SeedWithRelations[] =
            await planningSessionsApi.getSeeds(id);
          if (seeds.length > 0) {
            setSeedContextPrefix(buildSeedContextPrefix(seeds));
            setHasInjectedSeeds(false);
          }
        } catch {
          // Seed hydration is best-effort
        }
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes('active planning session')
        ) {
          // Show conflict dialog instead of window.confirm
          setConflictResumeSessionId(id);
          setConflictDialogOpen(true);
        }
      }
    },
    [sidebar, planningSession],
  );

  // ----- Conflict dialog handlers -----
  const handleConflictConfirm = useCallback(async () => {
    const id = conflictResumeSessionId;
    setConflictDialogOpen(false);
    setConflictResumeSessionId(null);
    if (!id) return;
    try {
      const resumed = await planningSession.resumeSession(id, true);
      sidebar.onSessionClick(id);
      sessionIdRef.current = resumed.id;

      try {
        const seeds: SeedWithRelations[] =
          await planningSessionsApi.getSeeds(id);
        if (seeds.length > 0) {
          setSeedContextPrefix(buildSeedContextPrefix(seeds));
          setHasInjectedSeeds(false);
        }
      } catch {
        // Seed hydration is best-effort
      }
    } catch {
      // Error handled silently
    }
  }, [conflictResumeSessionId, planningSession, sidebar]);

  const handleConflictCancel = useCallback(() => {
    setConflictDialogOpen(false);
    setConflictResumeSessionId(null);
  }, []);

  // ----- New session (from sidebar) -----
  const handleSidebarNewSession = useCallback(() => {
    sidebar.onNewSession();
    setHasInjectedSeeds(false);
    setSeedContextPrefix(null);
    setPendingSeedIds([]);
    setSubmittedSeedIds(new Set());
    setSeedsAutoCollapsed(false);
    prewarmSentRef.current = false;
    seedsMarkedAsToReviewRef.current = null;
    sessionIdRef.current = null;
    if (planningSession.isStreaming) {
      planningSession.cancelSession();
    }
    planningSession.reset();
    generation.resetGeneration();
    setShowChatPanel(false);
  }, [sidebar, planningSession, generation]);

  // ----- New session (from header button) -----
  const handleNewSession = useCallback(() => {
    setHasInjectedSeeds(false);
    setSeedContextPrefix(null);
    setPendingSeedIds([]);
    setSubmittedSeedIds(new Set());
    setSeedsAutoCollapsed(false);
    prewarmSentRef.current = false;
    seedsMarkedAsToReviewRef.current = null;
    sessionIdRef.current = null;
    sidebar.onNewSession();
    if (planningSession.isStreaming) {
      planningSession.cancelSession();
    }
    planningSession.reset();
    generation.resetGeneration();
    setShowChatPanel(false);
  }, [sidebar, planningSession, generation]);

  // ----- Create and track session (centralized session creation) -----
  const createAndTrackSession = useCallback(
    async (title: string): Promise<{ id: string }> => {
      const seeds = pendingSeedIds;

      const newSession = await planningSession.createSession({
        title,
        projectId: projectBoard.selectedProjectId || undefined,
        boardId: projectBoard.selectedBoardId || undefined,
        ...(seeds.length > 0 ? { seedIds: seeds } : {}),
      });
      sessionIdRef.current = newSession.id;
      if (seeds.length > 0) {
        void queryClient.invalidateQueries({
          queryKey: planningSessionKeys.seeds(newSession.id),
        });
      }
      setPendingSeedIds([]);
      return { id: newSession.id };
    },
    [
      planningSession,
      projectBoard.selectedProjectId,
      projectBoard.selectedBoardId,
      queryClient,
      pendingSeedIds,
    ],
  );

  // ----- Derive session title from attached seeds or default -----
  const deriveSessionTitle = useCallback((): string => {
    if (attachedSeeds.length > 0) {
      const first = attachedSeeds[0]!.title;
      if (attachedSeeds.length === 1)
        return first.length > 60 ? `${first.slice(0, 57)}...` : first;
      return `${first.length > 40 ? `${first.slice(0, 37)}...` : first} (+${attachedSeeds.length - 1})`;
    }
    return 'Sesión de planificación';
  }, [attachedSeeds]);

  // ----- Start session (empty state "Iniciar" button) -----
  const handleStartSession = useCallback(async () => {
    // Use ref-based lock for synchronous guard against rapid double-clicks.
    // React state (isStarting) is batched, so two quick clicks can both see
    // isStarting=false before the first setIsStarting(true) takes effect.
    if (startingLockRef.current) return;
    startingLockRef.current = true;
    setIsStarting(true);
    try {
      const { id } = await createAndTrackSession(deriveSessionTitle());
      setIsStarting(false);

      // Fire-and-forget pre-warm so the runner starts preparing immediately
      prewarmSentRef.current = true;
      const agentCfg = getAgentConfig?.();
      planningSessionsApi.prewarm(id, agentCfg).catch(() => {
        // Pre-warm is best-effort; the normal flow works as fallback
        prewarmSentRef.current = false;
      });
    } catch (err) {
      const isActiveSessionConflict =
        err instanceof Error && err.message.includes('active planning session');
      const isMissingRepository =
        err instanceof Error && err.message.includes('no configured repository');

      if (isMissingRepository) {
        setIsStarting(false);
        setShowChatPanel(false);
        showToast.error('Repositorio no configurado', {
          description: 'Este proyecto necesita un repositorio antes de planificar. Configuralo en la seccion de ajustes del proyecto.',
        });
        return;
      }

      if (isActiveSessionConflict) {
        // Auto-close the existing session and retry
        try {
          const sessions = await planningSessionsApi.list(
            new URLSearchParams({ status: 'active', limit: '1' }),
          );
          if (sessions.length > 0) {
            await planningSessionsApi.update(sessions[0]!.id, {
              status: 'completed',
            });
          }
          // Retry session creation
          const { id } = await createAndTrackSession(deriveSessionTitle());
          setIsStarting(false);

          prewarmSentRef.current = true;
          const agentCfgRetry = getAgentConfig?.();
          planningSessionsApi.prewarm(id, agentCfgRetry).catch(() => {
            prewarmSentRef.current = false;
          });
          return;
        } catch {
          // If auto-close also fails, fall through to show error
        }
      }

      setIsStarting(false);
      setShowChatPanel(false);
      showToast.error(
        isActiveSessionConflict
          ? 'No se pudo cerrar la sesión anterior. Inténtalo de nuevo.'
          : 'Error al iniciar la sesión de planificación',
      );
    } finally {
      // Release lock after a short delay to prevent rapid re-clicks
      setTimeout(() => {
        startingLockRef.current = false;
      }, 500);
    }
  }, [createAndTrackSession, deriveSessionTitle, getAgentConfig]);

  // ----- Restart ended session (resume instead of creating new) -----
  const isRestartingRef = useRef(false);
  const handleRestartEndedSession = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId || isRestartingRef.current) return;
    isRestartingRef.current = true;
    try {
      await handleSidebarSessionResume(sessionId);
      setShowChatPanel(true);
    } catch {
      showToast.error("No se pudo reanudar la sesión. Inténtalo de nuevo.");
    } finally {
      isRestartingRef.current = false;
    }
  }, [handleSidebarSessionResume]);

  // ----- Cancel generation -----
  const handleCancelGeneration = useCallback(() => {
    generation.resetGeneration();
    if (planningSession.isStreaming) {
      planningSession.cancelSession();
    }
    planningSession.reset();
    sessionIdRef.current = null;
    prewarmSentRef.current = false;
    seedsMarkedAsToReviewRef.current = null;
    setHasInjectedSeeds(false);
    setSeedContextPrefix(null);
    setPendingSeedIds([]);
    setSubmittedSeedIds(new Set());
    setSeedsAutoCollapsed(false);
    setShowChatPanel(false);
  }, [generation, planningSession]);

  // ----- Reset prewarm flag once streaming starts (first message was sent) -----
  useEffect(() => {
    if (planningSession.isStreaming) {
      prewarmSentRef.current = false;
    }
  }, [planningSession.isStreaming]);

  // ----- Mark seeds as to_review when session completes -----
  useEffect(() => {
    const sessionId = sessionIdRef.current;
    const isCompleted = planningSession.session?.status === 'completed';
    const hasSeeds = attachedSeeds.length > 0;
    const alreadyMarked = seedsMarkedAsToReviewRef.current === sessionId;

    if (isCompleted && sessionId && hasSeeds && !alreadyMarked) {
      // Mark this session as processed to prevent duplicate calls
      seedsMarkedAsToReviewRef.current = sessionId;

      planningSessionsApi.completeSeedsForSession(sessionId).catch((err) => {
        console.error('Failed to mark seeds as to_review:', err);
        // Reset ref so it can be retried if needed
        seedsMarkedAsToReviewRef.current = null;
      });
    }
  }, [planningSession.session?.status, attachedSeeds.length]);

  // ----- Cleanup: cancel prewarm if user leaves without sending a message -----
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (prewarmSentRef.current && sessionIdRef.current) {
        planningSession.cancelSession();
        prewarmSentRef.current = false;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // On unmount, cancel if prewarm was sent but no message followed
      if (prewarmSentRef.current && sessionIdRef.current) {
        planningSession.cancelSession();
        prewarmSentRef.current = false;
      }
    };
    // planningSession.cancelSession identity is stable (useCallback)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Accessor methods for state (consumed by usePlanningMessages) -----

  /**
   * If seed context is available and hasn't been injected yet, consume it:
   * mark as injected, clear the prefix, and return the prefix string.
   * Returns null if no prefix is available or already injected.
   */
  const consumeSeedContextPrefix = useCallback((): string | null => {
    if (!hasInjectedSeeds && seedContextPrefix) {
      const prefix = seedContextPrefix;
      setHasInjectedSeeds(true);
      setSeedContextPrefix(null);
      // Snapshot current seed IDs as submitted and auto-collapse
      setSubmittedSeedIds(new Set(attachedSeeds.map((s) => s.id)));
      setSeedsAutoCollapsed(true);
      return prefix;
    }
    return null;
  }, [hasInjectedSeeds, seedContextPrefix, attachedSeeds]);

  /** Toggle seeds collapsed state (user-driven). */
  const toggleSeedsCollapsed = useCallback(() => {
    setSeedsAutoCollapsed((prev) => !prev);
  }, []);

  /** Return the current session ID (avoids stale closures via ref). */
  const getSessionId = useCallback((): string | null => {
    return sessionIdRef.current;
  }, []);

  /** Set the session ID (used after creating a new session). */
  const setSessionIdValue = useCallback((id: string | null) => {
    sessionIdRef.current = id;
  }, []);

  return {
    // State
    isStarting,
    isSessionActive,
    showChatPanel,
    sessionId: planningSession.sessionId,
    isLoadingFromUrl,

    // State accessors (for usePlanningMessages)
    consumeSeedContextPrefix,
    getSessionId,
    setSessionId: setSessionIdValue,
    createAndTrackSession,

    // Seeds
    attachedSeeds,
    onRemoveSeed: handleRemoveSeed,
    onSeedImportComplete: handleSeedImportComplete,
    submittedSeedIds,
    hasInjectedSeeds,
    seedsAutoCollapsed,
    toggleSeedsCollapsed,

    // Session handlers
    onStartSession: handleStartSession,
    onNewSession: handleNewSession,
    onRestartEndedSession: handleRestartEndedSession,
    onSidebarSessionClick: handleSidebarSessionClick,
    onSidebarSessionResume: handleSidebarSessionResume,
    onSidebarNewSession: handleSidebarNewSession,
    onCancelGeneration: handleCancelGeneration,

    // Conflict dialog (replaces window.confirm)
    conflictDialog: {
      isOpen: conflictDialogOpen,
      onConfirm: handleConflictConfirm,
      onCancel: handleConflictCancel,
    },
  };
};
