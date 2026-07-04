/**
 * Whether the sprint selection has settled enough to fire the single-board
 * work-items query exactly once with the correct filter.
 *
 * On mount the active sprint is auto-selected asynchronously: firing the board
 * query before it resolves means one fetch with an empty sprint filter followed
 * by a refetch once the sprint id arrives (a doubled ~550KB board fetch). Gating
 * the board query on this predicate collapses that into a single request.
 *
 * A manual user selection resolves immediately (no auto-select to wait for).
 */
export const isSprintSelectionResolved = (
  hasManualSelection: boolean,
  isActiveSprintLoading: boolean,
): boolean => hasManualSelection || !isActiveSprintLoading;
