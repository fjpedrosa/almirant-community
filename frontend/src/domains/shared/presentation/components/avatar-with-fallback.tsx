import Image from "next/image";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface AvatarWithFallbackProps {
  /** Author avatar URL from the user table (if available) */
  avatarUrl: string | null;
  /** Author email for generating initials or identicon seed */
  email: string | null;
  /** Author name for initials */
  name: string | null;
  /** User ID for deterministic identicon seed */
  userId: string | null;
  /** Fallback seed when all else fails (e.g., ticketId) */
  fallbackSeed: string;
  /** Avatar size in pixels */
  size?: 36 | 40 | 48;
  className?: string;
}

// TODO(A-F-434-gravatar): Implement Gravatar fallback when md5 is available.
// For now, we skip Gravatar and fall back to identicon directly when avatarUrl is null.

/**
 * Simple hash function for deterministic color selection.
 * Returns a number in range [0, max).
 */
const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
};

/**
 * Generate initials from a name string.
 * Returns up to 2 uppercase letters.
 */
const getInitials = (name: string | null): string => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/**
 * Palette of background colors for identicon fallback.
 * Using tailwind-compatible color classes.
 */
const IDENTICON_COLORS = [
  "bg-red-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-yellow-500",
  "bg-lime-500",
  "bg-green-500",
  "bg-emerald-500",
  "bg-teal-500",
  "bg-cyan-500",
  "bg-sky-500",
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-purple-500",
  "bg-fuchsia-500",
  "bg-pink-500",
] as const;

/**
 * Get a deterministic background color based on a seed string.
 */
const getIdenticonColor = (seed: string): string => {
  const index = hashString(seed) % IDENTICON_COLORS.length;
  return IDENTICON_COLORS[index];
};

const SIZE_CLASSES = {
  36: "size-9", // 36px
  40: "size-10", // 40px
  48: "size-12", // 48px
} as const;

const TEXT_SIZE_CLASSES = {
  36: "text-sm",
  40: "text-sm",
  48: "text-base",
} as const;

/**
 * Avatar component with intelligent fallback chain.
 *
 * Fallback priority:
 * 1. avatarUrl (if present) - rendered via next/image
 * 2. Identicon with initials from name
 * 3. Identicon with first 2 chars of email
 * 4. Identicon with "?" using fallbackSeed for color
 *
 * This component is purely presentational - no hooks.
 *
 * Usage:
 * <AvatarWithFallback
 *   avatarUrl={author.avatarUrl}
 *   email={author.email}
 *   name={author.name}
 *   userId={author.userId}
 *   fallbackSeed={ticketId}
 *   size={40}
 * />
 */
export const AvatarWithFallback: React.FC<AvatarWithFallbackProps> = ({
  avatarUrl,
  email,
  name,
  userId,
  fallbackSeed,
  size = 40,
  className,
}) => {
  const sizeClass = SIZE_CLASSES[size];
  const textSizeClass = TEXT_SIZE_CLASSES[size];

  // Determine the seed for identicon color (deterministic)
  const colorSeed = userId ?? email ?? fallbackSeed;
  const bgColor = getIdenticonColor(colorSeed);

  // Determine initials to display
  const initials = name ? getInitials(name) : email ? email.substring(0, 2).toUpperCase() : "?";

  // If we have an avatar URL, use next/image
  if (avatarUrl) {
    return (
      <Avatar className={cn(sizeClass, className)}>
        <Image
          src={avatarUrl}
          alt={name ?? "Avatar"}
          width={size}
          height={size}
          className="aspect-square size-full object-cover"
        />
        <AvatarFallback className={cn(bgColor, "text-white font-medium", textSizeClass)}>
          {initials}
        </AvatarFallback>
      </Avatar>
    );
  }

  // Fallback: identicon with initials
  return (
    <Avatar className={cn(sizeClass, className)}>
      <AvatarFallback className={cn(bgColor, "text-white font-medium", textSizeClass)}>
        {initials}
      </AvatarFallback>
    </Avatar>
  );
};
