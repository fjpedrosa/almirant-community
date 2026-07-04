/**
 * Pure WS-reconnection recovery predicate for planning sessions.
 *
 * `RECOVER_SESSION` re-fetches the session + full transcript to re-sync against the
 * authoritative backend after the WebSocket dropped. It is EXPENSIVE (can pull up to
 * ~20k chunks), so it must fire ONLY on a genuine drop -> reconnect cycle — never on
 * the first connect after mount, nor on a tab-focus remount where the socket was
 * already connected. Those are not real drops.
 *
 * Framework-free so it can be unit-tested in isolation; the hook wires it to
 * `wsContext.isConnected` via a ref.
 */
export interface WsRecoverySnapshot {
  /** the connection state we last observed */
  wasConnected: boolean;
  /** true once the socket has reached the connected state at least once */
  hasEverConnected: boolean;
}

export const initialWsRecoverySnapshot = (
  isConnected: boolean,
): WsRecoverySnapshot => ({
  wasConnected: isConnected,
  hasEverConnected: isConnected,
});

/**
 * True only on a genuine reconnection after a REAL drop:
 *   - we had been connected at some earlier point (`hasEverConnected`), AND
 *   - we are transitioning disconnected -> connected (`!wasConnected && isConnected`).
 *
 * Returns FALSE on the very first connect after mount (never connected before) and
 * on a stable/already-connected socket — so it does not trigger a spurious full
 * transcript re-download on every mount / tab focus.
 */
export const shouldRecoverSession = (
  prev: WsRecoverySnapshot,
  next: { isConnected: boolean },
): boolean =>
  next.isConnected && !prev.wasConnected && prev.hasEverConnected;

/** Fold the latest connection state into the snapshot (latches `hasEverConnected`). */
export const advanceWsRecovery = (
  prev: WsRecoverySnapshot,
  next: { isConnected: boolean },
): WsRecoverySnapshot => ({
  wasConnected: next.isConnected,
  hasEverConnected: prev.hasEverConnected || next.isConnected,
});
