import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { X, Plus, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { GithubCommitItem } from "@/domains/github/presentation/components/github-commit-item";
import type { LinkedCommitsSectionProps } from "../../domain/types";

export const LinkedCommitsSection: React.FC<LinkedCommitsSectionProps> = ({
  commits,
  isLoading,
  onLinkCommit,
  onUnlinkCommit,
  isLinking,
  availableCommits,
  isSearchingCommits,
}) => {
  const t = useTranslations("workItems.linkedCommits");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const existingCommitIds = new Set(commits.map((c) => c.commitId));

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filteredCommits = (availableCommits ?? []).filter((commit) => {
    if (existingCommitIds.has(commit.id)) return false;
    if (!debouncedSearch.trim()) return true;
    const q = debouncedSearch.toLowerCase();
    return (
      commit.sha.toLowerCase().startsWith(q) ||
      commit.message.toLowerCase().includes(q)
    );
  });

  const handleSelect = (commitId: string) => {
    onLinkCommit?.(commitId);
    setSearch("");
    setPopoverOpen(false);
  };

  if (isLoading) return null;

  const hasLinkSupport = !!onLinkCommit && !!availableCommits;

  return (
    <div className="space-y-2">
      {hasLinkSupport && (
        <div className="flex items-center justify-end">
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 max-md:h-8 max-md:w-8"
                title={t("add")}
                aria-label={t("add")}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2" align="end">
              <Input
                placeholder={t("searchCommit")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-sm mb-2"
                autoFocus
              />
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {(isLinking || isSearchingCommits) && (
                  <div className="flex items-center justify-center py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!isLinking && !isSearchingCommits && filteredCommits.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    {t("noCommits")}
                  </p>
                )}
                {!isLinking &&
                  !isSearchingCommits &&
                  filteredCommits.slice(0, 20).map((commit) => (
                    <button
                      key={commit.id}
                      type="button"
                      className="w-full text-left px-2 py-1.5 rounded-sm text-sm hover:bg-accent flex items-center gap-2"
                      onClick={() => handleSelect(commit.id)}
                    >
                      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                        {commit.sha.substring(0, 7)}
                      </span>
                      <span className="truncate flex-1">{commit.message}</span>
                    </button>
                  ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Linked commits list */}
      {commits.length > 0 && (
        <div className="space-y-0.5" role="list">
          {commits.map((linked) => (
            <div
              key={linked.id}
              className="flex items-center gap-1 bg-muted/50 rounded px-2 group"
            >
              <div className="flex-1 min-w-0">
                <GithubCommitItem
                  sha={linked.commit.sha}
                  message={linked.commit.message}
                  authorLogin={linked.commit.authorLogin}
                  authorAvatarUrl={linked.commit.authorAvatarUrl}
                  branch={linked.commit.branch}
                  committedAt={linked.commit.committedAt}
                />
              </div>

              <Badge
                variant="outline"
                className="flex-shrink-0 text-[10px] px-1.5 py-0"
              >
                {linked.autoLinked ? t("auto") : t("manual")}
              </Badge>

              {onUnlinkCommit && !linked.autoLinked && (
                <button
                  type="button"
                  className="flex-shrink-0 touch-visible text-muted-foreground hover:text-destructive"
                  onClick={() => onUnlinkCommit(linked.commitId)}
                  title={t("unlink")}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
