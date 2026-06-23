export interface OAuthProviderConfig {
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  scopes: string;
  usePKCE: boolean;
  manualCodeEntry: boolean;
  extraAuthParams?: Record<string, string>;
  stealthHeaders?: Record<string, string>;
  tokenRequestFormat?: "form" | "json";
  includeStateInTokenExchange?: boolean;
  includeScopeInRefresh?: boolean;
  tokenRequestHeaders?: Record<string, string>;
  authMode: "bearer" | "api-key";
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  id_token?: string;
  exchangedApiKey?: string;
}

export interface OAuthProviderStatus {
  configured: boolean;
  connected: boolean;
  providerName: string;
  manualCodeEntry: boolean;
  connection: {
    id: string;
    keyPrefix: string;
    scopes: string | null;
    tokenExpiresAt: Date | null;
    createdAt: Date;
  } | null;
}
