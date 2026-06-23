"use client";

import { createContext, useContext } from "react";
import type { WsClientMessage, WsServerMessage } from "../../domain/ws-types";

export type WsStatus = "connecting" | "connected" | "disconnected" | "reconnecting";
type MessageHandler = (message: WsServerMessage) => void;

export interface WebSocketContextValue {
  status: WsStatus;
  isConnected: boolean;
  sendMessage: (message: WsClientMessage) => void;
  subscribe: (type: string, handler: MessageHandler) => () => void;
  reconnect: () => void;
}

export const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export const useWsContext = (): WebSocketContextValue => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWsContext must be used within a WebSocketProvider");
  }
  return context;
};

// Non-throwing version for conditional use outside provider
export const useWsContextOptional = (): WebSocketContextValue | null => {
  return useContext(WebSocketContext);
};
