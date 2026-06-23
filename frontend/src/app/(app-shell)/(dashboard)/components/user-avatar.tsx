"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type UserAvatarProps = {
  name: string | null | undefined;
  email?: string | null | undefined;
  imageUrl?: string | null | undefined;
  className?: string;
  imageAlt?: string;
};

const getInitials = (name: string | null | undefined, email?: string | null | undefined) => {
  const trimmed = (name ?? "").trim();
  if (trimmed.length > 0) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
    const initials = `${first}${last}`.toUpperCase();
    return initials.length > 0 ? initials : "U";
  }

  const emailInitial = (email ?? "").trim()[0]?.toUpperCase();
  return emailInitial && emailInitial.length > 0 ? emailInitial : "U";
};

export const UserAvatar: React.FC<UserAvatarProps> = ({
  name,
  email,
  imageUrl,
  className,
  imageAlt = "User avatar",
}) => {
  return (
    <Avatar className={className}>
      <AvatarImage src={imageUrl ?? undefined} alt={imageAlt} />
      <AvatarFallback aria-label={name ?? email ?? "User"}>
        {getInitials(name, email)}
      </AvatarFallback>
    </Avatar>
  );
};

