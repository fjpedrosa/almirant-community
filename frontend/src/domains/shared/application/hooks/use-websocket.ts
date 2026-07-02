"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WsClientMessage, WsServerMessage } from "../../domain/ws-types";
import { traceSink } from "@/domains/debug/application/trace-sink";
import { resolveBrowserWsBaseUrl } from "@/lib/runtime-service-url";

export type WsStatus = "connecting" | "connected" | "disconnected" | "reconnecting";
type MessageHandler = (message: WsServerMessage) => void;

const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_PENDING_MESSAGES = 20;
const HEARTBEAT_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

interface SessionTokenResult {
  token: string | null;
  shouldRetry: boolean;
}

const fetchSessionToken = async (): Promise<SessionTokenResult> => {
  try {
    const res = await fetch("/api/ws-token");
    if (res.status === 401) {
      return { token: null, shouldRetry: false };
    }

    if (!res.ok) {
      return { token: null, shouldRetry: true };
    }

    const data = await res.json();
    return { token: data.token ?? null, shouldRetry: false };
  } catch {
    return { token: null, shouldRetry: true };
  }
};

const buildWsUrl = (token: string): string => {
  const encodedToken = encodeURIComponent(token);
  const wsBase = resolveBrowserWsBaseUrl(
    process.env.NEXT_PUBLIC_WS_URL,
    process.env.NEXT_PUBLIC_API_URL
  );
  return `${wsBase}?token=${encodedToken}`;
};

const getReconnectDelay = (attempt: number): number => {
  const exponentialDelay = Math.min(
    BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt),
    MAX_RECONNECT_DELAY_MS
  );
  // Add jitter: +/- 25% randomness to prevent thundering herd
  const jitter = exponentialDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(exponentialDelay + jitter);
};

export interface UseWebSocketReturn {
  status: WsStatus;
  isConnected: boolean;
  sendMessage: (message: WsClientMessage) => void;
  subscribe: (type: string, handler: MessageHandler) => () => void;
  reconnect: () => void;
}

export const useWebSocket = (): UseWebSocketReturn => {
  const [status, setStatus] = useState<WsStatus>("disconnected");

  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<string, Set<MessageHandler>>>(new Map());
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMessagesRef = useRef<WsClientMessage[]>([]);
  const mountedRef = useRef(true);
  const intentionalCloseRef = useRef(false);
  const connectingRef = useRef(false);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (pongTimerRef.current) {
      clearTimeout(pongTimerRef.current);
      pongTimerRef.current = null;
    }
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const flushPendingMessages = useCallback((ws: WebSocket) => {
    if (
      pendingMessagesRef.current.length === 0 ||
      ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const queuedMessages = [...pendingMessagesRef.current];
    pendingMessagesRef.current = [];

    for (let index = 0; index < queuedMessages.length; index += 1) {
      try {
        ws.send(JSON.stringify(queuedMessages[index]));
      } catch (err) {
        pendingMessagesRef.current = queuedMessages.slice(index);
        console.error("[WS] Failed to flush queued message:", err);
        break;
      }
    }
  }, []);

  const enqueuePendingMessage = useCallback((message: WsClientMessage) => {
    if (pendingMessagesRef.current.length >= MAX_PENDING_MESSAGES) {
      pendingMessagesRef.current.shift();
    }
    pendingMessagesRef.current.push(message);
  }, []);

  const notifySubscribers = useCallback((message: WsServerMessage) => {
    if (process.env.NEXT_PUBLIC_DEBUG_TRACE === "1") {
      traceSink.push({
        t: Date.now(),
        kind: "ws-in",
        label: message.type,
        traceId: (message as unknown as Record<string, unknown>).traceId as string | undefined,
        jobId: (message as unknown as Record<string, unknown>).jobId as string | undefined,
        meta: { hasSubscriber: subscribersRef.current.has(message.type) },
      });
    }
    const handlers = subscribersRef.current.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(message);
        } catch (err) {
          console.error(`[WS] Error in subscriber for "${message.type}":`, err);
        }
      });
    }

    // Also notify wildcard subscribers that listen to all messages
    const wildcardHandlers = subscribersRef.current.get("*");
    if (wildcardHandlers) {
      wildcardHandlers.forEach((handler) => {
        try {
          handler(message);
        } catch (err) {
          console.error("[WS] Error in wildcard subscriber:", err);
        }
      });
    }
  }, []);

  const startHeartbeat = useCallback(
    (ws: WebSocket) => {
      clearHeartbeat();

      heartbeatTimerRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));

          // Start pong timeout - if no pong received, force reconnect
          pongTimerRef.current = setTimeout(() => {
            console.warn("[WS] Pong timeout - forcing reconnection");
            ws.close(4000, "Pong timeout");
          }, PONG_TIMEOUT_MS);
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    [clearHeartbeat]
  );

  const connect = useCallback(async () => {
    // Guard: don't connect if unmounted
    if (!mountedRef.current) return;

    // Guard: don't double-connect
    if (connectingRef.current) return;

    // Guard: don't connect if already connecting or connected
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.CONNECTING ||
        wsRef.current.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    connectingRef.current = true;

    // Fetch token from Next.js API route (reads HttpOnly cookie server-side)
    const tokenResult = await fetchSessionToken();
    const token = tokenResult.token;
    if (!token) {
      console.warn("[WS] No session token available - skipping connection");
      connectingRef.current = false;

      if (!mountedRef.current) {
        return;
      }

      if (!tokenResult.shouldRetry) {
        setStatus("disconnected");
        return;
      }

      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
        console.error("[WS] Max reconnect attempts reached while fetching ws-token");
        setStatus("disconnected");
        return;
      }

      const delay = getReconnectDelay(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      setStatus("reconnecting");
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current && !intentionalCloseRef.current) {
          connect();
        }
      }, delay);
      return;
    }

    if (!mountedRef.current) {
      connectingRef.current = false;
      return;
    }

    const url = buildWsUrl(token);
    intentionalCloseRef.current = false;

    setStatus(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        connectingRef.current = false;
        if (!mountedRef.current) {
          ws.close();
          return;
        }
        console.info("[WS] Connected");
        setStatus("connected");
        reconnectAttemptRef.current = 0;
        startHeartbeat(ws);
        flushPendingMessages(ws);
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data as string) as WsServerMessage;

          // Handle pong: clear the pong timeout
          if (message.type === "pong") {
            if (pongTimerRef.current) {
              clearTimeout(pongTimerRef.current);
              pongTimerRef.current = null;
            }
            return;
          }

          notifySubscribers(message);
        } catch (err) {
          console.error("[WS] Failed to parse message:", err);
        }
      };

      ws.onclose = (event: CloseEvent) => {
        clearHeartbeat();
        wsRef.current = null;
        connectingRef.current = false;

        if (!mountedRef.current) {
          setStatus("disconnected");
          return;
        }

        // Don't reconnect if we closed intentionally
        if (intentionalCloseRef.current) {
          setStatus("disconnected");
          return;
        }

        // Don't reconnect on auth errors (4001 = unauthorized)
        if (event.code === 4001) {
          console.warn("[WS] Unauthorized - not reconnecting");
          pendingMessagesRef.current = [];
          setStatus("disconnected");
          return;
        }

        // Attempt reconnection
        if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
          const delay = getReconnectDelay(reconnectAttemptRef.current);
          console.info(
            `[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})`
          );
          setStatus("reconnecting");
          reconnectAttemptRef.current += 1;

          clearReconnectTimer();
          reconnectTimerRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, delay);
        } else {
          console.error("[WS] Max reconnect attempts reached");
          setStatus("disconnected");
        }
      };

      ws.onerror = () => {
        // The close event will fire after error, so we let close handle reconnection.
        console.error("[WS] Connection error");
      };
    } catch (err) {
      console.error("[WS] Failed to create WebSocket:", err);
      connectingRef.current = false;
      setStatus("disconnected");
    }
  }, [
    clearHeartbeat,
    clearReconnectTimer,
    flushPendingMessages,
    notifySubscribers,
    startHeartbeat,
  ]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    connectingRef.current = false;
    clearReconnectTimer();
    clearHeartbeat();

    if (wsRef.current) {
      wsRef.current.close(1000, "Client disconnect");
      wsRef.current = null;
    }

    pendingMessagesRef.current = [];
    setStatus("disconnected");
    reconnectAttemptRef.current = 0;
  }, [clearHeartbeat, clearReconnectTimer]);

  const reconnect = useCallback(() => {
    console.info("[WS] Reconnecting (workspace switch)");
    disconnect();
    // Reset intentional close flag so reconnection logic works
    intentionalCloseRef.current = false;
    connect();
  }, [disconnect, connect]);

  const sendMessage = useCallback((message: WsClientMessage): void => {
    if (process.env.NEXT_PUBLIC_DEBUG_TRACE === "1") {
      traceSink.push({
        t: Date.now(),
        kind: "ws-out",
        label: message.type,
        meta: {
          readyState: wsRef.current?.readyState,
          clientActionId: (message as unknown as Record<string, unknown>).clientActionId as string | undefined,
          traceId: (message as unknown as Record<string, unknown>).traceId as string | undefined,
        },
      });
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      enqueuePendingMessage(message);
      console.warn("[WS] Queueing message - not connected");
      if (
        mountedRef.current &&
        !intentionalCloseRef.current &&
        !connectingRef.current &&
        !reconnectTimerRef.current
      ) {
        void connect();
      }
      return;
    }

    try {
      wsRef.current.send(JSON.stringify(message));
    } catch (err) {
      console.error("[WS] Failed to send message:", err);
    }
  }, [connect, enqueuePendingMessage]);

  const subscribe = useCallback(
    (type: string, handler: MessageHandler): (() => void) => {
      if (!subscribersRef.current.has(type)) {
        subscribersRef.current.set(type, new Set());
      }

      const handlers = subscribersRef.current.get(type)!;
      handlers.add(handler);

      // Return unsubscribe function
      return () => {
        handlers.delete(handler);
        if (handlers.size === 0) {
          subscribersRef.current.delete(type);
        }
      };
    },
    []
  );

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(() => ({
    status,
    isConnected: status === "connected",
    sendMessage,
    subscribe,
    reconnect,
  }), [status, sendMessage, subscribe, reconnect]);
};
