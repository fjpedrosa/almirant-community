// ---------------------------------------------------------------------------
// Vercel Domain Types
// ---------------------------------------------------------------------------
// All types, interfaces, and component props for the Vercel domain.
// NO classes -- only types and interfaces following Clean Architecture.
// ---------------------------------------------------------------------------

// ---- Data Interfaces ------------------------------------------------------

export interface VercelConnection {
  id: string;
  userId: string;
  teamId: string | null;
  teamName: string | null;
  tokenPrefix: string;
  scope: string | null;
  connected: boolean;
  installedAt: string | null;
  createdAt: string;
}

export interface VercelConnectionStatus {
  configured: boolean;
  connected: boolean;
  connection: VercelConnection | null;
}

export interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  link: { type: string; repo: string } | null;
  targets: Record<string, unknown> | null;
  latestDeployments: VercelDeployment[] | null;
}

export interface VercelDeployment {
  id: string;
  url: string;
  state: string;
  createdAt: string;
}

// ---- Component Props ------------------------------------------------------

export interface VercelConnectionButtonProps {
  isConfigured: boolean;
  isConnected: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}

export interface VercelConnectionStatusProps {
  status: VercelConnectionStatus;
  isLoading: boolean;
}

// empty for now - fetches its own data
export type VercelSettingsContainerProps = object;
