import { NotesAutosaveCoordinator } from "./autosave-coordinator";

export type CarryoverCoordinatorItem = { sourcePageId: string; sourceStateVersion: number };

const coordinators = new Map<string, NotesAutosaveCoordinator<never>>();

export const createCarryoverCoordinator = (
  item: CarryoverCoordinatorItem,
): NotesAutosaveCoordinator<never> => {
  const existing = coordinators.get(item.sourcePageId);
  // A conflict marks the coordinator as paused. Never reuse that instance
  // after the source was refetched: evict it so a fresh coordinator can
  // resume from the server's acknowledged state/version.
  if (existing?.state.status === "conflict") {
    coordinators.delete(item.sourcePageId);
  }
  const active = coordinators.get(item.sourcePageId);
  if (active && active.version === item.sourceStateVersion) return active;
  if (active && !active.isBusy && !active.hasPendingChanges) {
    active.resumeAtVersion(item.sourceStateVersion, true);
    return active;
  }
  if (active) return active;
  const coordinator = new NotesAutosaveCoordinator<never>({
    initialVersion: item.sourceStateVersion,
    save: async () => { throw new Error("CARRYOVER_DRAFT_UNSUPPORTED"); },
    isConflict: (error) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "NOTE_VERSION_CONFLICT"),
  });
  coordinators.set(item.sourcePageId, coordinator);
  return coordinator;
};

export const resetCarryoverCoordinators = (): void => {
  coordinators.clear();
};

export const evictCarryoverCoordinator = (sourcePageId: string): void => {
  coordinators.delete(sourcePageId);
};
