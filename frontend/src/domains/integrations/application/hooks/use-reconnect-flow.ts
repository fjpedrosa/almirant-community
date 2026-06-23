"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { connectionsApi } from "@/lib/api/client";
import { connectionKeys } from "./use-connections";
import type { ProviderType } from "../../domain/types";

export interface UseReconnectFlowReturn {
  isOpen: boolean;
  connectionId: string | null;
  connectionName: string;
  provider: ProviderType | null;
  open: (connectionId: string, connectionName: string, provider: ProviderType) => void;
  close: () => void;
  oauthState: string | null;
  isStartingOAuth: boolean;
  startOAuth: () => void;
  oauthCodeValue: string;
  setOAuthCodeValue: (value: string) => void;
  isSubmittingOAuthCode: boolean;
  submitOAuthCode: () => void;
  setupTokenValue: string;
  setSetupTokenValue: (value: string) => void;
  isSubmittingSetupToken: boolean;
  submitSetupToken: () => void;
  error: string | null;
}

export const useReconnectFlow = (): UseReconnectFlowReturn => {
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [connectionName, setConnectionName] = useState("");
  const [provider, setProvider] = useState<ProviderType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [oauthState, setOAuthState] = useState<string | null>(null);
  const [isStartingOAuth, setIsStartingOAuth] = useState(false);
  const [oauthCodeValue, setOAuthCodeValue] = useState("");
  const [isSubmittingOAuthCode, setIsSubmittingOAuthCode] = useState(false);

  const [setupTokenValue, setSetupTokenValue] = useState("");
  const [isSubmittingSetupToken, setIsSubmittingSetupToken] = useState(false);

  const open = useCallback(
    (id: string, name: string, prov: ProviderType) => {
      setConnectionId(id);
      setConnectionName(name);
      setProvider(prov);
      setError(null);
      setOAuthState(null);
      setOAuthCodeValue("");
      setSetupTokenValue("");
      setIsOpen(true);
    },
    [],
  );

  const close = useCallback(() => {
    setIsOpen(false);
    setConnectionId(null);
    setConnectionName("");
    setProvider(null);
    setError(null);
    setOAuthState(null);
    setOAuthCodeValue("");
    setSetupTokenValue("");
  }, []);

  const invalidateAndClose = useCallback(
    (message: string) => {
      queryClient.invalidateQueries({ queryKey: connectionKeys.all });
      showToast.success(message);
      close();
    },
    [queryClient, close],
  );

  const startOAuth = useCallback(async () => {
    if (!provider) return;
    setIsStartingOAuth(true);
    setError(null);

    try {
      const { url, state } = await connectionsApi.getOAuthUrl(provider);
      setOAuthState(state);
      window.open(url, "_blank");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start OAuth flow",
      );
    } finally {
      setIsStartingOAuth(false);
    }
  }, [provider]);

  const submitOAuthCode = useCallback(async () => {
    if (!connectionId || !oauthState || !oauthCodeValue.trim()) return;
    setIsSubmittingOAuthCode(true);
    setError(null);

    try {
      await connectionsApi.reconnect(connectionId, {
        code: oauthCodeValue.trim(),
        state: oauthState,
      });
      invalidateAndClose("Connection reconnected via OAuth");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reconnect via OAuth",
      );
    } finally {
      setIsSubmittingOAuthCode(false);
    }
  }, [connectionId, oauthState, oauthCodeValue, invalidateAndClose]);

  const submitSetupToken = useCallback(async () => {
    if (!connectionId || !setupTokenValue.trim()) return;
    setIsSubmittingSetupToken(true);
    setError(null);

    try {
      await connectionsApi.reconnect(connectionId, {
        setupToken: setupTokenValue.trim(),
      });
      invalidateAndClose("Connection reconnected with setup token");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to reconnect with setup token",
      );
    } finally {
      setIsSubmittingSetupToken(false);
    }
  }, [connectionId, setupTokenValue, invalidateAndClose]);

  return {
    isOpen,
    connectionId,
    connectionName,
    provider,
    open,
    close,
    oauthState,
    isStartingOAuth,
    startOAuth,
    oauthCodeValue,
    setOAuthCodeValue,
    isSubmittingOAuthCode,
    submitOAuthCode,
    setupTokenValue,
    setSetupTokenValue,
    isSubmittingSetupToken,
    submitSetupToken,
    error,
  };
};
