import type { Statements } from "@/lib/auth-permissions";

// ──────────────────────────────────────────────
// Permission helpers
// ──────────────────────────────────────────────

/**
 * The three organisation-level roles supported by Almirant.
 */
export type TeamRole = "owner" | "admin" | "member";

/**
 * Union of every resource defined in our access-control statements.
 */
export type Resource = keyof Statements;

/**
 * Union of every action allowed for a given resource.
 *
 * @example
 * type WorkItemAction = ActionFor<"workItem">;
 * // "create" | "read" | "update" | "delete" | "move" | "assign"
 */
export type ActionFor<R extends Resource> = Statements[R][number];

/**
 * A fully-qualified permission expressed as "resource:action".
 *
 * Useful for UI checks, route guards, and audit logs.
 *
 * @example
 * const p: Permission = "workItem:move";
 */
export type Permission = {
  [R in Resource]: `${R}:${ActionFor<R>}`;
}[Resource];

// ──────────────────────────────────────────────
// Domain entities
// ──────────────────────────────────────────────

/** Invitation status from Better-Auth organisation plugin. */
export type InvitationStatus = "pending" | "accepted" | "rejected" | "canceled";

/** A user embedded inside a member record. */
export interface TeamMemberUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
}

/** A team (organisation) as returned by Better-Auth. */
export interface Team {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/** A member within a team, including the nested user object. */
export interface TeamMember {
  id: string;
  organizationId: string;
  userId: string;
  role: TeamRole;
  createdAt: Date;
  user: TeamMemberUser;
}

/** An invitation to join a team. */
export interface TeamInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: TeamRole;
  status: InvitationStatus;
  inviterId: string;
  expiresAt: Date;
  createdAt: Date;
}

/** Full team detail including members and invitations. */
export interface TeamDetail extends Team {
  members: TeamMember[];
  invitations: TeamInvitation[];
}

// ──────────────────────────────────────────────
// Request DTOs
// ──────────────────────────────────────────────

export interface CreateTeamRequest {
  name: string;
  slug?: string;
  logo?: string;
}

export interface UpdateTeamRequest {
  name?: string;
  slug?: string;
  logo?: string;
}

export interface InviteMemberRequest {
  email: string;
  role: TeamRole;
}

export interface ResendInvitationRequest {
  email: string;
  role: TeamRole;
}

export interface UpdateMemberRoleRequest {
  memberId: string;
  role: TeamRole;
}

export interface RemoveMemberRequest {
  memberIdOrEmail: string;
}

// ──────────────────────────────────────────────
// Presentational component props
// ──────────────────────────────────────────────

export interface TeamCardProps {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  memberCount: number;
  isActive: boolean;
  onSelect: (id: string) => void;
}

export interface TeamListProps {
  teams: Team[];
  activeTeamId: string | null;
  isLoading: boolean;
  onSelectTeam: (id: string) => void;
  onCreateTeam: () => void;
}

export interface TeamDetailHeaderProps {
  name: string;
  slug: string;
  logo?: string | null;
  memberCount: number;
  canEditTeam: boolean;
  canDeleteTeam: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onBack: () => void;
}

export interface TeamMemberListProps {
  members: TeamMember[];
  invitations: TeamInvitation[];
  currentUserId: string | null;
  isLoading: boolean;
  canInviteMembers: boolean;
  canManageMembers: boolean;
  canManageInvitations: boolean;
  onInvite: () => void;
  onRemoveMember: (memberIdOrEmail: string) => void;
  onUpdateRole: (memberId: string, role: TeamRole) => void;
  onCancelInvitation: (invitationId: string) => void;
  onResendInvitation: (email: string, role: TeamRole) => void;
}

export interface InviteMemberDialogProps {
  isOpen: boolean;
  email: string;
  role: TeamRole;
  isSubmitting: boolean;
  isFormValid: boolean;
  emailError?: string;
  onEmailChange: (value: string) => void;
  onRoleChange: (value: TeamRole) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export interface InvitationListProps {
  invitations: TeamInvitation[];
  canManage: boolean;
  onCancel: (invitationId: string) => void;
}

export interface InvitationRowProps {
  id: string;
  email: string;
  role: TeamRole;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
  canManage: boolean;
  onCancel: (invitationId: string) => void;
}

export interface InvitationsSectionProps {
  invitations: TeamInvitation[];
  canManage: boolean;
  isInviteDialogOpen: boolean;
  inviteEmail: string;
  inviteRole: TeamRole;
  isInviting: boolean;
  isInviteFormValid: boolean;
  inviteEmailError?: string;
  onOpenInviteDialog: () => void;
  onCloseInviteDialog: () => void;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (value: TeamRole) => void;
  onInviteSubmit: () => void;
  onCancelInvitation: (invitationId: string) => void;
}

export interface TeamFormDialogProps {
  isOpen: boolean;
  name: string;
  slug: string;
  isSubmitting: boolean;
  onNameChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export interface TeamMemberRowProps {
  memberId: string;
  name: string;
  email: string;
  image?: string | null;
  role: TeamRole;
  isCurrentUser: boolean;
  canManageMembers: boolean;
  onRemove: (memberId: string) => void;
  onUpdateRole: (memberId: string, role: TeamRole) => void;
}

export interface MemberAvatarGroupProps {
  users: { name: string; image?: string | null }[];
  max?: number;
  size?: "sm" | "md";
}

export interface TeamSwitcherProps {
  teams: { id: string; name: string; slug: string; logo?: string | null }[];
  activeTeamId: string | null;
  isLoading: boolean;
  onSelectTeam: (teamId: string | null) => void;
}

/** Minimal user shape for the multi-select component. */
export interface SelectableUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export interface UserMultiSelectProps {
  availableUsers: SelectableUser[];
  selectedUserIds: string[];
  onSelect: (userId: string) => void;
  onRemove: (userId: string) => void;
  placeholder?: string;
  disabled?: boolean;
}
