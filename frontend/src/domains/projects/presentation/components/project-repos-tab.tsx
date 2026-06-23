"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, Trash2, ExternalLink, GitBranch, Check, ChevronsUpDown, Lock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProjectReposTabProps, RepositoryProvider } from "../../domain/types";

const providerIcons: Record<RepositoryProvider, string> = {
  github: "GH",
  gitlab: "GL",
  bitbucket: "BB",
  other: "R",
};

export const ProjectReposTab: React.FC<ProjectReposTabProps> = ({
  repositories,
  newRepoName,
  newRepoUrl,
  newRepoProvider,
  newRepoIsMonorepo,
  onNameChange,
  onUrlChange,
  onProviderChange,
  onMonorepoChange,
  onAddRepo,
  onDeleteRepo,
  isAdding,
  githubRepos,
  isLoadingGithubRepos,
  githubRepoSearchQuery,
  onGithubRepoSearchChange,
  onGithubRepoSelect,
  isGithubConnected,
}) => {
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const t = useTranslations("projects.reposTab");
  const tCommon = useTranslations("common");
  const showGithubSelector = newRepoProvider === "github" && isGithubConnected;

  return (
    <div className="space-y-4">
      {/* Add repo form */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {showGithubSelector ? (
              <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={comboboxOpen}
                    className="w-full justify-between font-normal"
                  >
                    {newRepoName
                      ? githubRepos?.find((r) => r.name === newRepoName)?.fullName ?? newRepoName
                      : t("selectRepo")}
                    {isLoadingGithubRepos ? (
                      <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin" />
                    ) : (
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(400px,calc(100vw-2rem))] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder={t("searchRepo")}
                      value={githubRepoSearchQuery}
                      onValueChange={onGithubRepoSearchChange}
                    />
                    <CommandList>
                      <CommandEmpty>
                        {isLoadingGithubRepos ? tCommon("loading") : t("noReposFound")}
                      </CommandEmpty>
                      <CommandGroup>
                        {(githubRepos ?? [])
                          .filter((repo) =>
                            !githubRepoSearchQuery ||
                            repo.fullName.toLowerCase().includes(githubRepoSearchQuery.toLowerCase()) ||
                            (repo.description ?? "").toLowerCase().includes(githubRepoSearchQuery.toLowerCase())
                          )
                          .map((repo) => (
                            <CommandItem
                              key={repo.id}
                              value={repo.fullName}
                              onSelect={() => {
                                onGithubRepoSelect?.(repo);
                                setComboboxOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  newRepoName === repo.name ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex flex-col min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium text-sm truncate">{repo.fullName}</span>
                                  {repo.isPrivate && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                                  {repo.language && (
                                    <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                                      {repo.language}
                                    </Badge>
                                  )}
                                </div>
                                {repo.description && (
                                  <span className="text-xs text-muted-foreground truncate">
                                    {repo.description}
                                  </span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <Input
                placeholder={t("repoNamePlaceholder")}
                value={newRepoName}
                onChange={(e) => onNameChange(e.target.value)}
              />
            )}
            <Input
              placeholder={t("repoUrlPlaceholder")}
              value={newRepoUrl}
              onChange={(e) => onUrlChange(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select
              value={newRepoProvider}
              onValueChange={(v) => onProviderChange(v as RepositoryProvider)}
            >
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="github">GitHub</SelectItem>
                <SelectItem value="gitlab">GitLab</SelectItem>
                <SelectItem value="bitbucket">Bitbucket</SelectItem>
                <SelectItem value="other">{t("other")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex min-h-9 items-center gap-2">
              <Switch
                id="monorepo"
                checked={newRepoIsMonorepo}
                onCheckedChange={onMonorepoChange}
              />
              <Label htmlFor="monorepo" className="text-sm">{t("monorepo")}</Label>
            </div>
            <Button
              size="sm"
              className="w-full sm:w-auto"
              onClick={onAddRepo}
              disabled={isAdding || !newRepoName.trim() || !newRepoUrl.trim()}
            >
              <Plus className="h-4 w-4 mr-1" />
              {isAdding ? t("adding") : t("add")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Repository list */}
      {repositories.length === 0 ? (
        <div className="text-center py-8">
          <GitBranch className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">{t("noRepos")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {repositories.map((repo) => (
            <Card key={repo.id}>
              <CardContent className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                    {providerIcons[repo.provider]}
                  </span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium">{repo.name}</span>
                      {repo.isMonorepo && (
                        <Badge variant="outline" className="text-xs">monorepo</Badge>
                      )}
                    </div>
                    <a
                      href={repo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <span className="truncate">{repo.url}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    </a>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 self-end text-muted-foreground hover:text-destructive sm:self-auto"
                  onClick={() => onDeleteRepo(repo.id)}
                  aria-label="Delete repository"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
