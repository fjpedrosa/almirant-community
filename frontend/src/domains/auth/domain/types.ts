export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface AuthBootstrapStatus {
  hasUsers: boolean;
  needsInitialAdminSetup: boolean;
  allowRegistration: boolean;
}

export type AuthCredentialsView = "sign_in" | "sign_up";
export type AuthPageMode = AuthCredentialsView | "initial_admin_setup";

/** Social OAuth providers the UI can surface, gated by backend availability. */
export type SocialAuthProvider = "google" | "github";

/** Which social providers the backend has enabled (resolved server-side). */
export interface EnabledAuthProviders {
  google: boolean;
  github: boolean;
}

export interface SignInCardProps {
  mode: AuthPageMode;
  values: {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
  };
  onValueChange: (
    field: "name" | "email" | "password" | "confirmPassword",
    value: string
  ) => void;
  onSubmit: () => void | Promise<void>;
  isLoading: boolean;
  error?: string | null;
  /** Social providers to offer. Omitted/empty ⇒ no social buttons rendered. */
  socialProviders?: Partial<EnabledAuthProviders>;
  onSocialSignIn?: (provider: SocialAuthProvider) => void;
}

export type AcceptInvitationStatus =
  | "loading"
  | "auth_required"
  | "accepting"
  | "success"
  | "error";

export interface AcceptInvitationCardProps {
  status: AcceptInvitationStatus;
  message: string;
  onSignIn: () => void;
}
