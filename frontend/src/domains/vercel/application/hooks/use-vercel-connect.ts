"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { vercelApi } from "@/lib/api/client";
import { vercelKeys } from "./use-vercel-status";

export const useVercelConnect = () => {
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);
  const waitingForOAuth = useRef(false);

  // When user returns to tab after Vercel OAuth, invalidate queries
  useEffect(() => {
    const handleFocus = () => {
      if (waitingForOAuth.current) {
        waitingForOAuth.current = false;
        setIsConnecting(false);
        queryClient.invalidateQueries({ queryKey: vercelKeys.all });
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [queryClient]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const { url } = await vercelApi.getAuthUrl();
      waitingForOAuth.current = true;
      window.open(url, "_blank");
    } catch {
      setIsConnecting(false);
    }
  }, []);

  const disconnectMutation = useMutation({
    mutationFn: () => vercelApi.disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vercelKeys.all });
    },
  });

  const handleDisconnect = useCallback(() => {
    disconnectMutation.mutate();
  }, [disconnectMutation]);

  return {
    handleConnect,
    handleDisconnect,
    isConnecting,
  };
};
