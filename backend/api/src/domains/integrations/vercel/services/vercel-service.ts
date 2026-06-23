import { env, logger } from "@almirant/config";

// ---- Constants ----

const VERCEL_API_BASE = "https://api.vercel.com";
const VERCEL_OAUTH_AUTHORIZE_URL = "https://vercel.com/oauth/authorize";
const VERCEL_TOKEN_ENDPOINT = `${VERCEL_API_BASE}/v2/oauth/access_token`;

// ---- Vercel API response types ----

interface VercelTokenResponse {
  access_token: string;
  token_type: string;
  team_id?: string;
}

interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  link?: {
    type: string;
    repo: string;
  };
  targets?: Record<string, unknown>;
  latestDeployments?: VercelDeployment[];
}

interface VercelProjectsResponse {
  projects: VercelProject[];
  pagination: {
    count: number;
    next: number | null;
    prev: number | null;
  };
}

interface VercelDeployment {
  id: string;
  url: string;
  state: string;
  readyState: string;
  createdAt: number;
}

interface CreateVercelProjectData {
  name: string;
  framework?: string;
  gitRepository?: {
    type: "github";
    repo: string;
  };
}

// ---- Configuration check ----

export const isVercelConfigured = (): boolean => {
  return Boolean(env.VERCEL_CLIENT_ID && env.VERCEL_CLIENT_SECRET);
};

// ---- OAuth helpers ----

export const getOAuthUrl = (state: string): string => {
  const params = new URLSearchParams({
    client_id: env.VERCEL_CLIENT_ID ?? "",
    state,
  });

  if (env.VERCEL_REDIRECT_URI) {
    params.set("redirect_uri", env.VERCEL_REDIRECT_URI);
  }

  return `${VERCEL_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
};

export const exchangeVercelCode = async (
  code: string
): Promise<VercelTokenResponse> => {
  if (!env.VERCEL_CLIENT_ID || !env.VERCEL_CLIENT_SECRET) {
    throw new Error(
      "Vercel OAuth credentials are not configured (VERCEL_CLIENT_ID, VERCEL_CLIENT_SECRET)"
    );
  }

  const body = new URLSearchParams({
    client_id: env.VERCEL_CLIENT_ID,
    client_secret: env.VERCEL_CLIENT_SECRET,
    code,
    redirect_uri: env.VERCEL_REDIRECT_URI ?? "",
  });

  const response = await fetch(VERCEL_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error(
      { status: response.status, body: errorBody },
      "Failed to exchange Vercel OAuth code for access token"
    );
    throw new Error(
      `Vercel token exchange failed with status ${response.status}: ${errorBody}`
    );
  }

  const data = (await response.json()) as VercelTokenResponse;

  logger.info(
    { teamId: data.team_id ?? "personal" },
    "Successfully exchanged Vercel OAuth code for access token"
  );

  return data;
};

// ---- Authenticated Vercel fetch ----

export const fetchFromVercel = async <T>(
  accessToken: string,
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> => {
  const url = path.startsWith("http") ? path : `${VERCEL_API_BASE}${path}`;
  const method = options?.method ?? "GET";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  const fetchOptions: RequestInit = { method, headers };

  if (options?.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Vercel API ${response.status} on ${method} ${path}: ${errorBody}`
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    logger.error(
      { path, method, error: error instanceof Error ? error.message : String(error) },
      "Vercel API request failed"
    );
    throw error;
  }
};

// ---- High-level API functions ----

export const listVercelProjects = async (
  accessToken: string,
  teamId?: string
): Promise<VercelProject[]> => {
  try {
    const params = new URLSearchParams();
    if (teamId) {
      params.set("teamId", teamId);
    }

    const query = params.toString();
    const path = `/v9/projects${query ? `?${query}` : ""}`;

    const data = await fetchFromVercel<VercelProjectsResponse>(accessToken, path);
    return data.projects;
  } catch (error) {
    logger.error(
      { teamId, error: error instanceof Error ? error.message : String(error) },
      "Failed to list Vercel projects"
    );
    throw error;
  }
};

export const createVercelProject = async (
  accessToken: string,
  data: CreateVercelProjectData,
  teamId?: string
): Promise<VercelProject> => {
  try {
    const params = new URLSearchParams();
    if (teamId) {
      params.set("teamId", teamId);
    }

    const query = params.toString();
    const path = `/v10/projects${query ? `?${query}` : ""}`;

    return await fetchFromVercel<VercelProject>(accessToken, path, {
      method: "POST",
      body: data,
    });
  } catch (error) {
    logger.error(
      { projectName: data.name, teamId, error: error instanceof Error ? error.message : String(error) },
      "Failed to create Vercel project"
    );
    throw error;
  }
};

export const triggerVercelDeploy = async (
  accessToken: string,
  projectId: string,
  teamId?: string
): Promise<VercelDeployment> => {
  try {
    const params = new URLSearchParams();
    if (teamId) {
      params.set("teamId", teamId);
    }

    const query = params.toString();
    const path = `/v13/deployments${query ? `?${query}` : ""}`;

    return await fetchFromVercel<VercelDeployment>(accessToken, path, {
      method: "POST",
      body: {
        name: projectId,
        target: "production",
      },
    });
  } catch (error) {
    logger.error(
      { projectId, teamId, error: error instanceof Error ? error.message : String(error) },
      "Failed to trigger Vercel deployment"
    );
    throw error;
  }
};
