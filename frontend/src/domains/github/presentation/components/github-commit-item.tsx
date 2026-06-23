"use client";

import { Badge } from "@/components/ui/badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { GitBranch } from "lucide-react";
import type { GithubCommitItemProps } from "../../domain/types";
import { timeAgo } from "./time-ago";

export const GithubCommitItem: React.FC<GithubCommitItemProps> = ({
  sha,
  message,
  authorLogin,
  authorAvatarUrl,
  branch,
  committedAt,
}) => {
  const shortSha = sha.slice(0, 7);
  const authorInitial = authorLogin ? authorLogin.charAt(0).toUpperCase() : "?";

  return (
    <div className="flex items-center gap-3 py-2" role="listitem">
      {/* Author avatar */}
      <Avatar className="h-6 w-6 flex-shrink-0">
        {authorAvatarUrl && (
          <AvatarImage src={authorAvatarUrl} alt={authorLogin ?? "Author"} />
        )}
        <AvatarFallback className="text-[10px]">{authorInitial}</AvatarFallback>
      </Avatar>

      {/* SHA */}
      <code className="flex-shrink-0 text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
        {shortSha}
      </code>

      {/* Message (truncated) */}
      <span className="flex-1 min-w-0 text-sm truncate" title={message}>
        {message}
      </span>

      {/* Branch badge */}
      {branch && (
        <Badge variant="outline" className="flex-shrink-0 text-[10px] px-1.5 py-0 gap-1">
          <GitBranch className="h-3 w-3" aria-hidden="true" />
          {branch}
        </Badge>
      )}

      {/* Relative time */}
      <time
        dateTime={committedAt}
        className="flex-shrink-0 text-xs text-muted-foreground w-14 text-right"
      >
        {timeAgo(committedAt)}
      </time>
    </div>
  );
};
