"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2, Play, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SessionSidebarItemProps } from "../../domain/types";

/** Animates title changes: old title fades out, new title types in character by character. */
const useAnimatedTitle = (title: string) => {
  const [displayTitle, setDisplayTitle] = useState(title);
  const [phase, setPhase] = useState<"idle" | "erasing" | "typing">("idle");
  const prevTitleRef = useRef(title);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (title === prevTitleRef.current) return;
    const oldTitle = prevTitleRef.current;
    prevTitleRef.current = title;

    // Skip animation on first mount or if old title was generic
    const isGeneric = oldTitle === "Sin titulo" || oldTitle.startsWith("Sesión de planificación");
    if (!isGeneric) {
      setDisplayTitle(title);
      return;
    }

    // Phase 1: Erase old title
    setPhase("erasing");
    let eraseLen = oldTitle.length;
    intervalRef.current = setInterval(() => {
      eraseLen -= 2;
      if (eraseLen <= 0) {
        clearInterval(intervalRef.current!);
        intervalRef.current = null;
        setDisplayTitle("");

        // Phase 2: Type new title
        setPhase("typing");
        let typeLen = 0;
        intervalRef.current = setInterval(() => {
          typeLen += 1;
          if (typeLen >= title.length) {
            clearInterval(intervalRef.current!);
            intervalRef.current = null;
            setDisplayTitle(title);
            setPhase("idle");
          } else {
            setDisplayTitle(title.slice(0, typeLen));
          }
        }, 30);
      } else {
        setDisplayTitle(oldTitle.slice(0, eraseLen));
      }
    }, 20);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [title]);

  return { displayTitle, isAnimating: phase !== "idle" };
};

const getInitials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

export const SessionSidebarItem: React.FC<SessionSidebarItemProps> = ({
  title,
  relativeDate,
  creatorName,
  creatorImage,
  isActive,
  canResume,
  status,
  onClick,
  onDelete,
  onResume,
}) => {
  const t = useTranslations("aiPlanning.session");
  const { displayTitle, isAnimating } = useAnimatedTitle(title);
  const resolvedCreatorName = creatorName?.trim() || t("unknownCreator");

  // Status indicator — show green dot for active sessions, amber dot for interrupted
  const renderStatusIndicator = () => {
    if (status === "active") {
      return (
        <span
          className="size-2 shrink-0 rounded-full bg-green-500 animate-pulse motion-reduce:animate-none"
          aria-label={t("statusActive")}
        />
      );
    }
    if (status === "interrupted") {
      return (
        <span
          className="size-2 shrink-0 rounded-full bg-amber-500"
          aria-label={t("statusInterrupted")}
        />
      );
    }
    return null;
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group relative mx-2 flex cursor-pointer items-center gap-2 rounded-md px-3 py-2.5 text-sm transition-colors min-h-[44px]",
        "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isActive && "bg-accent text-accent-foreground",
        status === "archived" && "opacity-60",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm leading-tight">
          {renderStatusIndicator()}
          <span className="truncate">
            {displayTitle}
            {isAnimating && (
              <span
                className="inline-block w-[1.5px] h-[0.85em] bg-foreground/60 ml-px align-text-bottom"
                style={{ animation: "cursor-blink 0.6s step-end infinite" }}
              />
            )}
          </span>
        </p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <Avatar className="size-4 shrink-0">
            {creatorImage && (
              <AvatarImage
                src={creatorImage}
                alt={resolvedCreatorName}
              />
            )}
            <AvatarFallback className="text-[9px]">
              {getInitials(resolvedCreatorName)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{resolvedCreatorName}</span>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          {relativeDate}
        </p>
      </div>

      {/* Three-dot menu — visible on hover */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
            aria-label="Session options"
          >
            <MoreHorizontal className="size-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-44">
          {canResume && (
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onResume();
              }}
            >
              <Play className="size-4" />
              {t("resumeTooltip")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4 text-destructive" />
            {t("deleteTooltip")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <style>{`
        @keyframes cursor-blink {
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};
