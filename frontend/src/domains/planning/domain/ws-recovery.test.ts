import { describe, expect, it } from "bun:test";
import {
  advanceWsRecovery,
  initialWsRecoverySnapshot,
  shouldRecoverSession,
  type WsRecoverySnapshot,
} from "./ws-recovery";

// The OLD inline predicate that lived in use-planning-session.ts:
//   const wasDisconnected = !prevConnectedRef.current;
//   const isNowConnected = isWsConnected;
//   if (wasDisconnected && isNowConnected && sessionIdRef.current) { RECOVER }
// It fired on the FIRST connect after mount (prev=false -> true), which is NOT a
// real WS drop. We model it here to prove the regression the new predicate fixes.
const oldShouldRecover = (prevConnected: boolean, isNowConnected: boolean): boolean =>
  !prevConnected && isNowConnected;

describe("shouldRecoverSession (gate RECOVER_SESSION to REAL WS drops)", () => {
  it("does NOT recover on the first connect after mount (WS started disconnected)", () => {
    // mount: socket not yet connected
    const snap = initialWsRecoverySnapshot(false);
    // socket connects for the FIRST time
    expect(shouldRecoverSession(snap, { isConnected: true })).toBe(false);
    // ...whereas the OLD logic wrongly treated this as a reconnection:
    expect(oldShouldRecover(/* prevConnected */ false, /* now */ true)).toBe(true);
  });

  it("does NOT recover when WS was already connected at mount and stays connected", () => {
    const snap = initialWsRecoverySnapshot(true);
    expect(shouldRecoverSession(snap, { isConnected: true })).toBe(false);
  });

  it("recovers ONLY after a genuine drop->reconnect cycle", () => {
    // first connect (no recover)
    let snap = initialWsRecoverySnapshot(false);
    expect(shouldRecoverSession(snap, { isConnected: true })).toBe(false);
    snap = advanceWsRecovery(snap, { isConnected: true });

    // real drop (no recover on the drop itself)
    expect(shouldRecoverSession(snap, { isConnected: false })).toBe(false);
    snap = advanceWsRecovery(snap, { isConnected: false });

    // reconnection after a REAL drop -> recover
    expect(shouldRecoverSession(snap, { isConnected: true })).toBe(true);
  });

  it("does NOT recover on a stable connection (no transition)", () => {
    let snap = initialWsRecoverySnapshot(false);
    snap = advanceWsRecovery(snap, { isConnected: true });
    // still connected, effect re-runs for an unrelated reason
    expect(shouldRecoverSession(snap, { isConnected: true })).toBe(false);
  });

  it("advanceWsRecovery latches hasEverConnected and tracks last state", () => {
    const start: WsRecoverySnapshot = initialWsRecoverySnapshot(false);
    expect(start).toEqual({ wasConnected: false, hasEverConnected: false });

    const afterConnect = advanceWsRecovery(start, { isConnected: true });
    expect(afterConnect).toEqual({ wasConnected: true, hasEverConnected: true });

    const afterDrop = advanceWsRecovery(afterConnect, { isConnected: false });
    // hasEverConnected must NOT reset on a drop
    expect(afterDrop).toEqual({ wasConnected: false, hasEverConnected: true });
  });
});
