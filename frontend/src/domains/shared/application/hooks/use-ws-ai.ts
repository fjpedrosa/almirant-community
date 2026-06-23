"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWsContextOptional } from "./use-ws-context";
import type {
  WsServerMessage,
  WsServerAiResult,
  WsServerAiError,
  AiFieldContext,
} from "../../domain/ws-types";

interface PendingRequest {
  status: "pending" | "accepted" | "completed" | "error";
  workItemId?: string;
  onResult?: (result: WsServerAiResult["payload"]) => void;
  onError?: (error: WsServerAiError["payload"]) => void;
}

interface RequestAiFormatOptions {
  text: string;
  fieldContext: AiFieldContext;
  workItemId?: string;
  onResult?: (result: WsServerAiResult["payload"]) => void;
  onError?: (error: WsServerAiError["payload"]) => void;
}

export interface UseWsAiReturn {
  requestAiFormat: (options: RequestAiFormatOptions) => string | null;
  isProcessing: (requestId: string) => boolean;
  isAnyProcessing: boolean;
  isAvailable: boolean;
}

let requestCounter = 0;
const generateRequestId = (): string => {
  requestCounter += 1;
  return `ai-${Date.now()}-${requestCounter}`;
};

export const useWsAi = (): UseWsAiReturn => {
  const wsContext = useWsContextOptional();
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());
  const [processingCount, setProcessingCount] = useState(0);

  const isAvailable = wsContext?.isConnected ?? false;

  // Subscribe to AI-related messages
  useEffect(() => {
    if (!wsContext) return;

    const handleAccepted = (message: WsServerMessage) => {
      if (message.type !== "ai:accepted") return;
      const pending = pendingRef.current.get(message.requestId);
      if (pending) {
        pending.status = "accepted";
      }
    };

    const handleResult = (message: WsServerMessage) => {
      if (message.type !== "ai:result") return;
      const pending = pendingRef.current.get(message.requestId);
      if (pending) {
        pending.status = "completed";
        pending.onResult?.(message.payload);
        pendingRef.current.delete(message.requestId);
        setProcessingCount((c) => Math.max(0, c - 1));
      }
    };

    const handleError = (message: WsServerMessage) => {
      if (message.type !== "ai:error") return;
      const pending = pendingRef.current.get(message.requestId);
      if (pending) {
        pending.status = "error";
        pending.onError?.(message.payload);
        pendingRef.current.delete(message.requestId);
        setProcessingCount((c) => Math.max(0, c - 1));
      }
    };

    const unsubs = [
      wsContext.subscribe("ai:accepted", handleAccepted),
      wsContext.subscribe("ai:result", handleResult),
      wsContext.subscribe("ai:error", handleError),
    ];

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [wsContext]);

  const requestAiFormat = useCallback(
    (options: RequestAiFormatOptions): string | null => {
      if (!wsContext?.isConnected) return null;

      const requestId = generateRequestId();

      pendingRef.current.set(requestId, {
        status: "pending",
        workItemId: options.workItemId,
        onResult: options.onResult,
        onError: options.onError,
      });

      setProcessingCount((c) => c + 1);

      wsContext.sendMessage({
        type: "ai:format-text",
        requestId,
        payload: {
          text: options.text,
          fieldContext: options.fieldContext,
          workItemId: options.workItemId,
        },
      });

      return requestId;
    },
    [wsContext]
  );

  const isProcessing = useCallback(
    (requestId: string): boolean => {
      const pending = pendingRef.current.get(requestId);
      return !!pending && (pending.status === "pending" || pending.status === "accepted");
    },
    []
  );

  return {
    requestAiFormat,
    isProcessing,
    isAnyProcessing: processingCount > 0,
    isAvailable,
  };
};
