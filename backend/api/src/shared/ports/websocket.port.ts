/**
 * WebSocket port — shared interface for real-time messaging across domains.
 *
 * Domain modules depend on this port instead of directly importing the
 * ws-connection-manager singleton, enabling easier testing and future
 * transport changes (e.g. SSE, external pub/sub).
 */

export interface WsMessage {
  type: string;
  payload?: unknown;
}

export interface WebSocketPort {
  sendToUser(userId: string, message: WsMessage): void;
  broadcastToWorkspace(workspaceId: string, message: WsMessage): void;
  getConnectionCount(): number;
  getUserCount(): number;
}
