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
