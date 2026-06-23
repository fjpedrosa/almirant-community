"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import { connectionsApi } from "@/lib/api/client";
import { useCreateConnection } from "./use-connections";
import type { ProviderType, SubscriptionWizardStep } from "../../domain/types";
const VALIDATION_DEBOUNCE_MS = 800;

export interface UseSubscriptionConnectReturn {
  provider: ProviderType;
  isActive: boolean;
  step: SubscriptionWizardStep;
  tokenValue: string;
  tokenError: string | null;
  isValidating: boolean;
  isValid: boolean;
  connectionName: string;
  isSaving: boolean;
  start: (provider: ProviderType) => void;
  reset: () => void;
  handleTokenChange: (value: string) => void;
  handleConnectionNameChange: (value: string) => void;
  handleNext: () => void;
  handleBack: () => void;
  handleSave: (scope: "user" | "organization") => Promise<void>;
  // CLI flow
  canUseCli: boolean;
  cliCommand: string | null;
  isPollingCli: boolean;
  cliError: string | null;
  startCliFlow: (scope: "user" | "organization") => void;
  // Device code flow
  deviceCode: string | null;
  deviceVerificationUrl: string | null;
  isPollingDevice: boolean;
  deviceError: string | null;
  startDeviceCodeFlow: (scope: "user" | "organization") => void;
}

export const useSubscriptionConnect = (): UseSubscriptionConnectReturn => {
  const t = useTranslations("integrations.toasts");
  const [provider, setProvider] = useState<ProviderType>("anthropic");
  const isAnthropicSubscription = provider === "anthropic";
  const isOpenAiSubscription = provider === "openai";
  const usesOAuthCallback = isAnthropicSubscription || isOpenAiSubscription;
  const canUseCli = provider === "openai";
  const [isActive, setIsActive] = useState(false);
  const [step, setStep] = useState<SubscriptionWizardStep>("instructions");
  const [tokenValue, setTokenValue] = useState("");
  const [connectionName, setConnectionName] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // CLI flow state
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [cliScope, setCliScope] = useState<"user" | "organization">("user");
  const [cliError, setCliError] = useState<string | null>(null);
  const [oauthState, setOAuthState] = useState<string | null>(null);

  // Device code flow state
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [deviceAuthId, setDeviceAuthId] = useState<string | null>(null);
  const [deviceVerificationUrl, setDeviceVerificationUrl] = useState<string | null>(null);
  const [deviceScope, setDeviceScope] = useState<"user" | "organization">("organization");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const devicePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const oauthPopupRef = useRef<Window | null>(null);
  const oauthPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queryClient = useQueryClient();
  const createConnection = useCreateConnection();

  const clearOAuthPopup = useCallback((closeWindow = false) => {
    if (oauthPollRef.current) {
      clearInterval(oauthPollRef.current);
      oauthPollRef.current = null;
    }

    if (closeWindow) {
      oauthPopupRef.current?.close();
    }

    oauthPopupRef.current = null;
  }, []);

  const monitorOpenAiOAuthPopup = useCallback(
    (popup: Window | null, fallbackState: string) => {
      if (!popup) {
        setIsValidating(false);
        setTokenError(
          "OpenAI authorization popup was blocked. Allow popups and try again.",
        );
        return;
      }

      clearOAuthPopup();
      oauthPopupRef.current = popup;

      oauthPollRef.current = setInterval(() => {
        const currentPopup = oauthPopupRef.current;

        if (!currentPopup || currentPopup.closed) {
          clearOAuthPopup();
          setIsValidating(false);
          setIsValid(false);
          setTokenError(
            "OpenAI authorization was closed before the callback completed.",
          );
          return;
        }

        try {
          const popupUrl = new URL(currentPopup.location.href);
          const code = popupUrl.searchParams.get("code");
          const nextState =
            popupUrl.searchParams.get("state") ?? fallbackState;
          const error = popupUrl.searchParams.get("error");
          const errorDescription =
            popupUrl.searchParams.get("error_description");

          if (!code && !error) {
            return;
          }

          clearOAuthPopup(true);
          setIsValidating(false);

          if (error) {
            setIsValid(false);
            setTokenError(
              errorDescription || "Failed to authorize the OpenAI connection.",
            );
            return;
          }

          setTokenValue(code ?? "");
          setOAuthState(nextState);
          setIsValid(Boolean(code));
          setTokenError(null);
          setStep("confirm");
        } catch {
          // Ignore cross-origin reads until the popup returns to the configured redirect URI.
        }
      }, 500);
    },
    [clearOAuthPopup],
  );

  const start = useCallback((nextProvider: ProviderType) => {
    setProvider(nextProvider);
    setIsActive(true);
    setStep("instructions");
    setTokenValue("");
    setConnectionName("");
    setTokenError(null);
    setIsValid(false);
    setOAuthState(null);
  }, []);

  const reset = useCallback(() => {
    setIsActive(false);
    setStep("instructions");
    setTokenValue("");
    setConnectionName("");
    setTokenError(null);
    setIsValid(false);
    setIsValidating(false);
    setIsSaving(false);
    // Clean up link token
    if (linkToken) {
      void connectionsApi.deleteLinkToken(linkToken).catch(() => {});
    }
    setLinkToken(null);
    setCliError(null);
    setOAuthState(null);
    clearOAuthPopup(true);
    // Clean up device code polling
    if (devicePollRef.current) {
      clearInterval(devicePollRef.current);
      devicePollRef.current = null;
    }
    setDeviceCode(null);
    setDeviceAuthId(null);
    setDeviceVerificationUrl(null);
    setDeviceError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, [clearOAuthPopup, linkToken]);

  const validateToken = useCallback(
    async (value: string) => {
      if (!value.trim()) {
        setTokenError(null);
        setIsValid(false);
        return;
      }

      setTokenError(null);
      setIsValid(Boolean(oauthState && value.trim()));
    },
    [oauthState],
  );

  const handleTokenChange = useCallback(
    (value: string) => {
      setTokenValue(value);
      setIsValid(false);
      setTokenError(null);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (usesOAuthCallback) {
        void validateToken(value);
        return;
      }

      if (value.trim().length > 0) {
        debounceRef.current = setTimeout(() => {
          void validateToken(value);
        }, VALIDATION_DEBOUNCE_MS);
      }
    },
    [usesOAuthCallback, validateToken],
  );

  const handleConnectionNameChange = useCallback((value: string) => {
    setConnectionName(value);
  }, []);

  const handleNext = useCallback(() => {
    if (step === "instructions") {
      // OpenAI uses device code flow (no popup needed)
      if (isOpenAiSubscription) {
        setIsValidating(true);
        setTokenError(null);
        void (async () => {
          try {
            const result = await connectionsApi.requestDeviceCode();
            setDeviceCode(result.userCode);
            setDeviceAuthId(result.deviceAuthId);
            setDeviceVerificationUrl(result.verificationUrl);
            setStep("device-code");
            // Open verification URL for user
            if (typeof window !== "undefined") {
              window.open(result.verificationUrl, "_blank");
            }
          } catch (err) {
            setTokenError(
              err instanceof Error ? err.message : "Failed to start OpenAI device code flow",
            );
          } finally {
            setIsValidating(false);
          }
        })();
        return;
      }

      if (!usesOAuthCallback) {
        setStep("paste");
        return;
      }

      // Anthropic OAuth popup flow
      setIsValidating(true);
      setTokenError(null);

      const authWindow =
        typeof window !== "undefined" ? window.open("", "_blank") : null;

      void (async () => {
        try {
          const { url, state } = await connectionsApi.getOAuthUrl(provider);
          setOAuthState(state);
          setTokenValue("");
          setIsValid(false);
          setStep("paste");

          if (authWindow) {
            authWindow.location.href = url;
          }

          setIsValidating(false);
        } catch (err) {
          clearOAuthPopup(true);
          setTokenError(
            err instanceof Error
              ? err.message
              : "Failed to start Anthropic OAuth flow",
          );
          setStep("instructions");
          setIsValidating(false);
        } finally {
          setIsValidating(false);
        }
      })();
      return;
    }

    if (step === "paste" && isValid) {
      setStep("confirm");
    }
  }, [
    clearOAuthPopup,
    isOpenAiSubscription,
    isValid,
    provider,
    step,
    usesOAuthCallback,
  ]);

  // ---------------------------------------------------------------------------
  // CLI flow: link token polling
  // ---------------------------------------------------------------------------

  const isPollingCli = !!linkToken && step === "cli";

  const linkTokenQuery = useQuery({
    queryKey: ["link-token-status", linkToken],
    queryFn: () => connectionsApi.getLinkTokenStatus(linkToken!),
    enabled: isPollingCli,
    refetchInterval: isPollingCli ? 2000 : false,
  });

  // When CLI completes the link token, auto-create the connection
  useEffect(() => {
    if (
      linkTokenQuery.data?.status !== "completed" ||
      !linkTokenQuery.data.credentials ||
      isSaving
    )
      return;

    const { credentials, config, connectionName: cliName } = linkTokenQuery.data;
    const finalName = cliName?.trim() || `${provider === "anthropic" ? "Claude Max" : "ChatGPT Pro"} (CLI)`;

    setIsSaving(true);
    void (async () => {
      try {
        await createConnection.mutateAsync({
          provider,
          category: "ai",
          scope: cliScope,
          name: finalName,
          credentials,
          config: config ?? undefined,
        });
        showToast.success(t("subscriptionCliConnected"));
        // Clean up the link token
        if (linkToken) {
          void connectionsApi.deleteLinkToken(linkToken).catch(() => {});
        }
        queryClient.invalidateQueries({ queryKey: ["connections"] });
        reset();
      } catch (err) {
        setCliError(err instanceof Error ? err.message : "Failed to save CLI connection");
      } finally {
        setIsSaving(false);
      }
    })();
  }, [linkTokenQuery.data, isSaving, provider, cliScope, linkToken, createConnection, queryClient, reset, t]);

  const startCliFlow = useCallback(
    async (scope: "user" | "organization") => {
      if (!canUseCli) {
        showToast.error("Claude Max subscriptions must be connected via OAuth from the dashboard.");
        return;
      }

      setCliScope(scope);
      setCliError(null);
      try {
        const result = await connectionsApi.createLinkToken({ provider, scope });
        setLinkToken(result.token);
        setStep("cli");
      } catch (err) {
        setCliError(err instanceof Error ? err.message : "Failed to create link token");
      }
    },
    [canUseCli, provider],
  );

  const cliCommand = linkToken
    ? `npx @almirant/connect ${provider} --token ${linkToken}`
    : null;

  // ---------------------------------------------------------------------------
  // Device code flow: start + polling
  // ---------------------------------------------------------------------------

  const isPollingDevice = step === "device-code" && !!deviceAuthId;

  const startDeviceCodeFlow = useCallback(
    async (scope: "user" | "organization") => {
      setDeviceScope(scope);
      setDeviceError(null);
      setIsValidating(true);
      try {
        const result = await connectionsApi.requestDeviceCode();
        setDeviceCode(result.userCode);
        setDeviceAuthId(result.deviceAuthId);
        setDeviceVerificationUrl(result.verificationUrl);
        setStep("device-code");
        if (typeof window !== "undefined") {
          window.open(result.verificationUrl, "_blank");
        }
      } catch (err) {
        setDeviceError(err instanceof Error ? err.message : "Failed to start device code flow");
      } finally {
        setIsValidating(false);
      }
    },
    [],
  );

  // Poll for device code completion
  useEffect(() => {
    if (!isPollingDevice || !deviceAuthId || !deviceCode) return;

    const poll = async () => {
      try {
        const result = await connectionsApi.pollDeviceToken({
          deviceAuthId,
          userCode: deviceCode,
          scope: deviceScope,
          name: connectionName.trim() || "ChatGPT Pro",
        });

        if (result.status === "completed") {
          showToast.success(t("openaiConnected"));
          queryClient.invalidateQueries({ queryKey: ["connections"] });
          reset();
          return;
        }

        if (result.status === "expired") {
          setDeviceError("Device code expired. Please try again.");
          if (devicePollRef.current) {
            clearInterval(devicePollRef.current);
            devicePollRef.current = null;
          }
          return;
        }

        if (result.status === "error") {
          setDeviceError(result.error ?? "Unknown error");
          if (devicePollRef.current) {
            clearInterval(devicePollRef.current);
            devicePollRef.current = null;
          }
        }
      } catch {
        // Network error — keep polling
      }
    };

    devicePollRef.current = setInterval(poll, 5000);
    // Also poll immediately
    void poll();

    return () => {
      if (devicePollRef.current) {
        clearInterval(devicePollRef.current);
        devicePollRef.current = null;
      }
    };
  }, [isPollingDevice, deviceAuthId, deviceCode, deviceScope, connectionName, queryClient, reset, t]);

  const handleBack = useCallback(() => {
    if (step === "confirm") {
      if (isOpenAiSubscription) {
        setTokenValue("");
        setIsValid(false);
        setTokenError(null);
        setOAuthState(null);
        setStep("instructions");
        return;
      }

      setStep("paste");
      return;
    }

    if (step === "paste") {
      clearOAuthPopup(true);
      setTokenValue("");
      setIsValid(false);
      setTokenError(null);
      setOAuthState(null);
      setIsValidating(false);
      setStep("instructions");
    }
    else if (step === "cli") {
      // Cancel CLI flow
      if (linkToken) {
        void connectionsApi.deleteLinkToken(linkToken).catch(() => {});
      }
      setLinkToken(null);
      setCliError(null);
      setStep("instructions");
    }
    else if (step === "device-code") {
      if (devicePollRef.current) {
        clearInterval(devicePollRef.current);
        devicePollRef.current = null;
      }
      setDeviceCode(null);
      setDeviceAuthId(null);
      setDeviceVerificationUrl(null);
      setDeviceError(null);
      setStep("instructions");
    }
  }, [clearOAuthPopup, isOpenAiSubscription, linkToken, step]);

  const handleSave = useCallback(
    async (scope: "user" | "organization") => {
      if (!connectionName.trim() || !isValid) return;

      setIsSaving(true);
      try {
        if (!oauthState) {
          throw new Error(
            `${provider === "anthropic" ? "Anthropic" : "OpenAI"} OAuth session expired. Start the connection again.`,
          );
        }

        await connectionsApi.handleOAuthCallback(provider, {
          code: tokenValue.trim(),
          state: oauthState,
          scope,
          category: "ai",
          name: connectionName.trim(),
        });

        showToast.success(t("subscriptionConnected"));
        queryClient.invalidateQueries({ queryKey: ["connections"] });
        reset();
      } catch (err) {
        showToast.error(err instanceof Error ? err.message : t("connectionFailed"));
      } finally {
        setIsSaving(false);
      }
    },
    [
      oauthState,
      connectionName,
      isValid,
      provider,
      queryClient,
      reset,
      tokenValue,
      t,
    ],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      clearOAuthPopup(true);
    };
  }, [clearOAuthPopup]);

  return {
    provider,
    isActive,
    step,
    tokenValue,
    tokenError,
    isValidating,
    isValid,
    connectionName,
    isSaving,
    start,
    reset,
    handleTokenChange,
    handleConnectionNameChange,
    handleNext,
    handleBack,
    handleSave,
    // CLI flow
    canUseCli,
    cliCommand,
    isPollingCli,
    cliError,
    startCliFlow,
    // Device code flow
    deviceCode,
    deviceVerificationUrl,
    isPollingDevice,
    deviceError,
    startDeviceCodeFlow,
  };
};
