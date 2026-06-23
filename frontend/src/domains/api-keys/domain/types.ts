import type { UseFormReturn } from "react-hook-form";

// API Key entity (returned by GET /api-keys)
export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

// Response from POST /api-keys (includes plaintext key, shown only once)
export interface ApiKeyCreated {
  id: string;
  name: string;
  keyPrefix: string;
  key: string;
  createdAt: string;
}

// Form data
export interface ApiKeyFormData {
  name: string;
}

// Component props
export interface ApiKeyListProps {
  apiKeys: ApiKey[];
  isLoading: boolean;
  onRevoke: (id: string, name: string) => void;
  onCreateClick: () => void;
}

export interface CreateApiKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<ApiKeyFormData>;
  isPending: boolean;
  onSubmit: (data: ApiKeyFormData) => void;
}

export interface ApiKeyCreatedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  createdKey: ApiKeyCreated | null;
}

// Service Account types
export interface ServiceAccount {
  id: string;
  organizationId: string;
  name: string;
  type: "runner" | "integration";
  keyPrefix: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceAccountKeysProps {
  serviceAccounts: ServiceAccount[];
  isLoading: boolean;
  onRotateKey: (id: string, name: string) => void;
  rotatingId: string | null;
}

export interface RotateKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newKey: string | null;
}
