import { env } from "@almirant/config";
import {
  decryptCredentials,
  encryptCredentials,
  getInstanceTailnetDatabaseAccess,
  updateInstanceTailnetDatabaseAccess,
  type InstanceTailnetDatabaseAccess,
  type TailnetDatabaseAccessStatus,
  type TailnetDatabaseAuthMethod,
} from "@almirant/database";
import {
  getTailnetDatabaseInfraJob,
  getTailnetDatabaseRuntimeStatus,
  startTailnetDatabaseApply,
  startTailnetDatabaseDisable,
  type TailnetDatabaseApplyAuth,
} from "./tailnet-database-updater-service";

const DEFAULT_HOSTNAME = "almirant-db";
const DEFAULT_TAG = "tag:almirant-db";
const HOSTNAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TAG_RE = /^tag:[a-z0-9](?:[a-z0-9-]{0,62})$/;

export interface ConnectTailnetDatabaseInput {
  authMethod: TailnetDatabaseAuthMethod;
  authKey?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  hostname?: string;
  tag?: string;
}

export interface TailnetDatabaseStatusView {
  enabled: boolean;
  status: TailnetDatabaseAccessStatus;
  authMethod: TailnetDatabaseAuthMethod | null;
  hostname: string;
  tag: string;
  tailscaleIp: string | null;
  tailnetName: string | null;
  magicDnsName: string | null;
  connectionString: string | null;
  lastJobId: string | null;
  lastError: string | null;
  connectionTestedAt: string | null;
  lastConnectedAt: string | null;
  updaterAvailable: boolean;
}

const normalizeHostname = (value?: string): string =>
  (value?.trim().toLowerCase() || DEFAULT_HOSTNAME);

const normalizeTag = (value?: string): string =>
  (value?.trim().toLowerCase() || DEFAULT_TAG);

const validateHostname = (hostname: string): void => {
  if (!HOSTNAME_RE.test(hostname)) {
    throw new Error(
      "Hostname must be 1-63 lowercase letters, numbers or hyphens, and cannot start or end with a hyphen",
    );
  }
};

const validateTag = (tag: string): void => {
  if (!TAG_RE.test(tag)) {
    throw new Error("Tag must look like tag:almirant-db using lowercase letters, numbers or hyphens");
  }
};

const requireEncryptionKey = (): string => {
  if (!env.ENCRYPTION_KEY) {
    throw new Error("ENCRYPTION_KEY is not configured. Cannot store Tailscale credentials.");
  }
  return env.ENCRYPTION_KEY;
};

const buildConnectionString = (
  row: InstanceTailnetDatabaseAccess,
): string | null => {
  if (!row.enabled || row.status !== "connected") return null;

  try {
    const source = new URL(env.DATABASE_URL);
    const host = row.tailnetName ? `${row.hostname}.${row.tailnetName}` : row.hostname;
    source.hostname = host;
    source.port = "5432";
    return source.toString();
  } catch {
    return null;
  }
};

const toMagicDnsName = (row: InstanceTailnetDatabaseAccess): string | null => {
  if (!row.tailnetName) return null;
  return `${row.hostname}.${row.tailnetName}`;
};

const toView = (
  row: InstanceTailnetDatabaseAccess,
  updaterAvailable: boolean,
): TailnetDatabaseStatusView => ({
  enabled: row.enabled,
  status: row.status,
  authMethod: row.authMethod,
  hostname: row.hostname,
  tag: row.tag,
  tailscaleIp: row.tailscaleIp,
  tailnetName: row.tailnetName,
  magicDnsName: toMagicDnsName(row),
  connectionString: buildConnectionString(row),
  lastJobId: row.lastJobId,
  lastError: row.lastError,
  connectionTestedAt: row.connectionTestedAt?.toISOString() ?? null,
  lastConnectedAt: row.lastConnectedAt?.toISOString() ?? null,
  updaterAvailable,
});

const refreshProvisioningStatus = async (
  row: InstanceTailnetDatabaseAccess,
): Promise<InstanceTailnetDatabaseAccess> => {
  if (row.status !== "provisioning" || !row.lastJobId) return row;

  const job = await getTailnetDatabaseInfraJob(row.lastJobId);
  if (!job) return row;

  if (job.status === "failed") {
    return updateInstanceTailnetDatabaseAccess({
      status: "error",
      lastError: job.errorMessage ?? "Tailnet database provisioning failed",
    });
  }

  if (job.status !== "success") return row;

  const runtime = await getTailnetDatabaseRuntimeStatus();
  if (!runtime?.online) {
    return updateInstanceTailnetDatabaseAccess({
      status: "error",
      lastError: runtime?.error ?? "Tailscale database sidecar is not online after provisioning",
    });
  }

  return updateInstanceTailnetDatabaseAccess({
    enabled: true,
    status: "connected",
    tailscaleIp: runtime.tailscaleIp,
    tailnetName: runtime.tailnetName,
    lastConnectedAt: new Date(),
    lastError: null,
  });
};

const buildApplyAuth = (input: ConnectTailnetDatabaseInput): TailnetDatabaseApplyAuth => {
  if (input.authMethod === "auth_key") {
    const authKey = input.authKey?.trim();
    if (!authKey || authKey.length < 20 || !authKey.startsWith("tskey-auth-")) {
      throw new Error("A valid Tailscale auth key starting with tskey-auth- is required");
    }
    return { method: "auth_key", authKey };
  }

  const oauthClientId = input.oauthClientId?.trim();
  const oauthClientSecret = input.oauthClientSecret?.trim();
  if (!oauthClientId || oauthClientId.length < 6) {
    throw new Error("Tailscale OAuth client ID is required");
  }
  if (
    !oauthClientSecret ||
    oauthClientSecret.length < 20 ||
    !oauthClientSecret.startsWith("tskey-client-")
  ) {
    throw new Error("A valid Tailscale OAuth client secret starting with tskey-client- is required");
  }
  return { method: "oauth_client", oauthClientId, oauthClientSecret };
};

export const getTailnetDatabaseAccessStatus = async (): Promise<TailnetDatabaseStatusView> => {
  const current = await getInstanceTailnetDatabaseAccess();
  const runtime = await getTailnetDatabaseRuntimeStatus();
  const updaterAvailable = runtime !== null;

  let row = await refreshProvisioningStatus(current);

  if (row.status === "connected" && runtime) {
    const runtimeLooksConnected = runtime.online && runtime.proxyServiceState === "running";
    if (!runtimeLooksConnected) {
      row = await updateInstanceTailnetDatabaseAccess({
        status: "error",
        lastError: runtime.error ?? "Tailnet database sidecar is not healthy",
      });
    } else if (
      runtime.tailscaleIp !== row.tailscaleIp ||
      runtime.tailnetName !== row.tailnetName
    ) {
      row = await updateInstanceTailnetDatabaseAccess({
        tailscaleIp: runtime.tailscaleIp,
        tailnetName: runtime.tailnetName,
      });
    }
  }

  return toView(row, updaterAvailable);
};

export const connectTailnetDatabaseAccess = async (
  input: ConnectTailnetDatabaseInput,
): Promise<TailnetDatabaseStatusView> => {
  const encryptionKey = requireEncryptionKey();
  const hostname = normalizeHostname(input.hostname);
  const tag = normalizeTag(input.tag);
  validateHostname(hostname);
  validateTag(tag);

  const auth = buildApplyAuth(input);
  const credentials = auth.method === "auth_key"
    ? { authKey: auth.authKey }
    : {
        oauthClientId: auth.oauthClientId,
        oauthClientSecret: auth.oauthClientSecret,
      };
  const encrypted = encryptCredentials(credentials, encryptionKey);

  await updateInstanceTailnetDatabaseAccess({
    enabled: false,
    status: "provisioning",
    authMethod: input.authMethod,
    hostname,
    tag,
    tailscaleIp: null,
    tailnetName: null,
    lastError: null,
    encryptedCredentials: encrypted.encryptedCredentials,
    credentialsIv: encrypted.credentialsIv,
    credentialsAuthTag: encrypted.credentialsAuthTag,
  });

  const result = await startTailnetDatabaseApply({ hostname, tag, auth });
  if (!result.ok) {
    const row = await updateInstanceTailnetDatabaseAccess({
      status: "error",
      lastError: result.reason,
    });
    return toView(row, false);
  }

  const row = await updateInstanceTailnetDatabaseAccess({
    lastJobId: result.result.jobId,
  });

  return toView(row, true);
};

export const testTailnetDatabaseAccess = async (): Promise<TailnetDatabaseStatusView> => {
  const current = await getInstanceTailnetDatabaseAccess();
  const runtime = await getTailnetDatabaseRuntimeStatus();

  if (!runtime?.online || runtime.proxyServiceState !== "running") {
    const row = await updateInstanceTailnetDatabaseAccess({
      status: "error",
      lastError: runtime?.error ?? "Tailnet database sidecar is not online",
    });
    return toView(row, runtime !== null);
  }

  const row = await updateInstanceTailnetDatabaseAccess({
    enabled: true,
    status: "connected",
    tailscaleIp: runtime.tailscaleIp,
    tailnetName: runtime.tailnetName,
    connectionTestedAt: new Date(),
    lastConnectedAt: current.lastConnectedAt ?? new Date(),
    lastError: null,
  });

  return toView(row, true);
};

export const disableTailnetDatabaseAccess = async (): Promise<TailnetDatabaseStatusView> => {
  const result = await startTailnetDatabaseDisable();
  if (!result.ok) {
    const row = await updateInstanceTailnetDatabaseAccess({
      status: "error",
      lastError: result.reason,
    });
    return toView(row, false);
  }

  const row = await updateInstanceTailnetDatabaseAccess({
    enabled: false,
    status: "not_configured",
    authMethod: null,
    tailscaleIp: null,
    tailnetName: null,
    lastJobId: result.result.jobId,
    lastError: null,
    encryptedCredentials: null,
    credentialsIv: null,
    credentialsAuthTag: null,
    connectionTestedAt: null,
    lastConnectedAt: null,
  });

  return toView(row, true);
};

export const getStoredTailnetDatabaseCredentials = async (): Promise<Record<string, unknown> | null> => {
  const row = await getInstanceTailnetDatabaseAccess();
  if (!row.encryptedCredentials || !row.credentialsIv || !row.credentialsAuthTag) {
    return null;
  }
  return decryptCredentials(row, requireEncryptionKey());
};
