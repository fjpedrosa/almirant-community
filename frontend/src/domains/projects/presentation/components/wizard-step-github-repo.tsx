"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, GitBranch, Github, Lock, Globe, Plus } from "lucide-react";
import Image from "next/image";
import type { WizardStepGithubRepoProps } from "../../domain/types";

export const WizardStepGithubRepo: React.FC<WizardStepGithubRepoProps> = ({
  installations,
  selectedInstallationId,
  onSelectInstallation,
  repos,
  isLoadingRepos,
  selectedRepoFullName,
  onSelectRepo,
  createNewRepo,
  onToggleCreateNew,
  newRepoName,
  onNewRepoNameChange,
  newRepoIsPrivate,
  onTogglePrivate,
  isCreatingRepo,
  githubMode,
  needsOAuthForRepoCreation,
  onConnectGitHub,
  needsReconnect,
  onReconnectGitHub,
}) => {
  const t = useTranslations("projects.wizard.githubRepo");

  // Token expired — show reconnect banner regardless of mode
  if (needsReconnect) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>

        <div className="flex flex-col items-center gap-4 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-8">
          <AlertTriangle className="h-10 w-10 text-amber-600 dark:text-amber-400" />
          <div className="text-center space-y-1">
            <p className="font-medium">{t("tokenExpiredTitle")}</p>
            <p className="text-sm text-muted-foreground">
              {t("tokenExpiredDescription")}
            </p>
          </div>
          <Button type="button" onClick={onReconnectGitHub}>
            <Github className="h-4 w-4 mr-2" />
            {t("reconnectAction")}
          </Button>
        </div>
      </div>
    );
  }

  // Mode: "none" — user has no GitHub connection at all
  if (githubMode === "none") {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-8">
          <Github className="h-10 w-10 text-muted-foreground" />
          <div className="text-center space-y-1">
            <p className="font-medium">{t("connectAccountTitle")}</p>
            <p className="text-sm text-muted-foreground">
              {t("connectAccountDescription")}
            </p>
          </div>
          <Button type="button" onClick={onConnectGitHub}>
            <Github className="h-4 w-4 mr-2" />
            {t("connectAccountAction")}
          </Button>
        </div>
      </div>
    );
  }

  // Mode: "oauth" — user has OAuth connection but no App installation
  if (githubMode === "oauth") {
    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>

        {/* New repo form — only option in OAuth mode */}
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Github className="h-4 w-4" />
            <span>{t("personalAccountHint")}</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-repo-name">{t("repoName")}</Label>
            <Input
              id="new-repo-name"
              value={newRepoName}
              onChange={(event) => onNewRepoNameChange(event.target.value)}
              placeholder={t("repoNamePlaceholder")}
              disabled={isCreatingRepo}
              autoFocus
            />
          </div>
          <div className="flex items-center gap-3">
            <Checkbox
              id="repo-private"
              checked={newRepoIsPrivate}
              onCheckedChange={onTogglePrivate}
              disabled={isCreatingRepo}
            />
            <Label htmlFor="repo-private" className="flex items-center gap-2 cursor-pointer">
              <Lock className="h-3.5 w-3.5" />
              {t("privateRepo")}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("readmeNote")}
          </p>
        </div>
      </div>
    );
  }

  // Mode: "app" — full GitHub App experience (existing behavior)
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>

      {/* Installation selector (only if multiple) */}
      {installations.length > 1 ? (
        <div className="space-y-2">
          <Label>{t("githubAccount")}</Label>
          <div className="flex flex-wrap gap-2">
            {installations.map((installation) => (
              <button
                key={installation.id}
                type="button"
                onClick={() => onSelectInstallation(installation.installationId)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  selectedInstallationId === installation.installationId
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted"
                }`}
              >
                {installation.accountAvatarUrl ? (
                  <Image
                    src={installation.accountAvatarUrl}
                    alt={installation.accountLogin}
                    width={20}
                    height={20}
                    className="h-5 w-5 rounded-full"
                  />
                ) : null}
                <span>{installation.accountLogin}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Toggle: create new repo */}
      <div className="flex items-center gap-3 rounded-lg border p-4">
        <Switch
          checked={createNewRepo}
          onCheckedChange={onToggleCreateNew}
          id="create-new-repo"
          aria-label={t("createNewRepo")}
        />
        <Label htmlFor="create-new-repo" className="flex items-center gap-2 cursor-pointer">
          <Plus className="h-4 w-4" />
          {t("createNewRepo")}
        </Label>
      </div>

      {createNewRepo ? (
        needsOAuthForRepoCreation ? (
          /* Personal account needs OAuth to create repos */
          <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-6">
            <Github className="h-8 w-8 text-muted-foreground" />
            <div className="text-center space-y-1">
              <p className="font-medium text-sm">{t("personalAccountOAuthTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("personalAccountOAuthDescription")}
              </p>
            </div>
            <Button type="button" size="sm" onClick={onConnectGitHub}>
              <Github className="h-4 w-4 mr-2" />
              {t("connectAccountAction")}
            </Button>
          </div>
        ) : (
        /* New repo form */
        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-2">
            <Label htmlFor="new-repo-name">{t("repoName")}</Label>
            <Input
              id="new-repo-name"
              value={newRepoName}
              onChange={(event) => onNewRepoNameChange(event.target.value)}
              placeholder={t("repoNamePlaceholder")}
              disabled={isCreatingRepo}
              autoFocus
            />
          </div>
          <div className="flex items-center gap-3">
            <Checkbox
              id="repo-private"
              checked={newRepoIsPrivate}
              onCheckedChange={onTogglePrivate}
              disabled={isCreatingRepo}
            />
            <Label htmlFor="repo-private" className="flex items-center gap-2 cursor-pointer">
              <Lock className="h-3.5 w-3.5" />
              {t("privateRepo")}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("readmeNote")}
          </p>
        </div>
        )
      ) : (
        /* Existing repos list */
        <div className="space-y-2">
          <Label>{t("availableRepos")}</Label>
          {isLoadingRepos ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : repos.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-lg border p-4">
              {t("noReposFound")}
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1 rounded-lg border p-2">
              {repos.map((repo) => {
                const isSelected = selectedRepoFullName === repo.full_name;
                return (
                  <button
                    key={repo.id}
                    type="button"
                    onClick={() => onSelectRepo(repo)}
                    className={`flex items-center justify-between w-full rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
                      isSelected ? "bg-primary/10 border border-primary" : "hover:bg-muted"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{repo.name}</p>
                        {repo.description ? (
                          <p className="text-xs text-muted-foreground truncate">
                            {repo.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {repo.language ? (
                        <Badge variant="secondary" className="text-xs">
                          {repo.language}
                        </Badge>
                      ) : null}
                      {repo.private ? (
                        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
