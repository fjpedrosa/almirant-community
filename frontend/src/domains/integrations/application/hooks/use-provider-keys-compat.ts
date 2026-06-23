"use client";

import { useMemo } from "react";
import { useConnections } from "./use-connections";

// ---------------------------------------------------------------------------
// Compatibility types matching the old provider-keys domain shape
// ---------------------------------------------------------------------------

interface ProviderKeyCompat {
  id: string;
  name: string;
  provider: string;
  isActive: boolean;
  lastUsedAt: string | null;
}

// ---------------------------------------------------------------------------
// Compatibility hook: wraps useConnections(category=ai) to provide the same
// shape that the old useProviderKeys() returned. Consumers like
// use-model-selector and use-ai-provider-preference rely on this.
// ---------------------------------------------------------------------------

export const useProviderKeysCompat = () => {
  const params = useMemo(() => {
    const p = new URLSearchParams();
    p.set("category", "ai");
    return p;
  }, []);

  const query = useConnections(params);

  const data = useMemo<ProviderKeyCompat[] | undefined>(() => {
    if (!query.data) return undefined;
    return query.data.map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      isActive: c.isActive,
      lastUsedAt: c.lastUsedAt,
    }));
  }, [query.data]);

  return {
    ...query,
    data,
  };
};
