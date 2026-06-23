import React from "react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { WsClientMessage } from "../../domain/ws-types";
import { useWebSocket } from "./use-websocket";

type MockWsInstance = {
  readyState: number;
  send: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
  onopen: (() => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
};

const createdSockets: MockWsInstance[] = [];

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  send = mock(() => {});
  close = mock(() => {
    this.readyState = MockWebSocket.CLOSED;
  });
  onopen: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(url: string) {
    void url;
    createdSockets.push(this);
  }
}

const fetchMock = mock(async () => ({
  ok: true,
  status: 200,
  json: async () => ({ token: "ws-token" }),
}));

const message: WsClientMessage = {
  type: "planning:prompt",
  clientActionId: "action-1",
  payload: {
    sessionId: "session-1",
    prompt: "Continua",
  },
};

const Harness = () => {
  const ws = useWebSocket();

  return (
    <div>
      <span data-testid="status">{ws.status}</span>
      <button type="button" onClick={() => ws.sendMessage(message)}>
        enviar
      </button>
    </div>
  );
};

describe("useWebSocket", () => {
  afterEach(() => {
    createdSockets.length = 0;
    fetchMock.mockClear();
  });

  it("reenvia los mensajes encolados cuando el socket termina de conectar", async () => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;

    render(<Harness />);

    await waitFor(() => {
      expect(createdSockets).toHaveLength(1);
    });

    act(() => {
      screen.getByText("enviar").click();
    });

    expect(createdSockets[0]?.send).not.toHaveBeenCalled();

    act(() => {
      createdSockets[0]!.readyState = MockWebSocket.OPEN;
      createdSockets[0]!.onopen?.();
    });

    expect(createdSockets[0]?.send).toHaveBeenCalledTimes(1);
    expect(createdSockets[0]?.send).toHaveBeenCalledWith(JSON.stringify(message));
    expect(screen.getByTestId("status")).toHaveTextContent("connected");
  });
});
