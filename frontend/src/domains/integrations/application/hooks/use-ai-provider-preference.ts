"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useProviderKeysCompat } from "./use-provider-keys-compat";

const STORAGE_KEY = "mc-ai-provider-key-id";

// ---------------------------------------------------------------------------
// useSyncExternalStore plumbing for localStorage
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

const subscribeToStore = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const getSnapshot = () => localStorage.getItem(STORAGE_KEY);
const getServerSnapshot = () => null;

const writeStoredKeyId = (id: string | null): void => {
  if (id === null) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, id);
  }
  // Notify subscribers so useSyncExternalStore picks up the change.
  listeners.forEach((l) => l());
};

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

interface UseAiProviderPreferenceReturn {
  selectedKeyId: string | null;
  setSelectedKeyId: (id: string | null) => void;
  clearPreference: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useAiProviderPreference = (): UseAiProviderPreferenceReturn => {
  const { data: providerKeys } = useProviderKeysCompat();

  // useSyncExternalStore reads localStorage on the client and returns null
  // on the server, avoiding hydration mismatches.
  const rawKeyId = useSyncExternalStore(
    subscribeToStore,
    getSnapshot,
    getServerSnapshot,
  );

  // Active key ids for validation
  const activeKeyIds = useMemo(
    () =>
      new Set(
        (providerKeys ?? []).filter((k) => k.isActive).map((k) => k.id),
      ),
    [providerKeys],
  );

  // Derive the validated key id. If the stored key no longer exists among
  // active keys we simply report null. The stale localStorage value is
  // harmless and will be cleaned up on the next explicit write.
  const selectedKeyId = useMemo(() => {
    // Keys haven't loaded yet -- return the stored value optimistically.
    if (providerKeys === undefined) return rawKeyId;

    if (rawKeyId !== null && !activeKeyIds.has(rawKeyId)) {
      return null;
    }

    return rawKeyId;
  }, [rawKeyId, providerKeys, activeKeyIds]);

  const setSelectedKeyId = useCallback((id: string | null) => {
    writeStoredKeyId(id);
  }, []);

  const clearPreference = useCallback(() => {
    writeStoredKeyId(null);
  }, []);

  return { selectedKeyId, setSelectedKeyId, clearPreference };
};
