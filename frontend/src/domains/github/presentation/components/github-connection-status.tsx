"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { GithubConnectionStatusProps } from "../../domain/types";

export const GithubConnectionStatus: React.FC<GithubConnectionStatusProps> = ({
  status,
  isLoading,
}) => {
  const t = useTranslations("github");
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">{t("connection")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  const { configured, installations, linkedRepos = [] } = status;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          {t("connection")}
          {configured ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!configured ? (
          <p className="text-sm text-muted-foreground">
            {t("notConnected")}
          </p>
        ) : (
          <div className="space-y-4">
            {/* Installations */}
            {installations.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("installations")}
                </h4>
                <ul className="space-y-2" aria-label="GitHub installations">
                  {installations.map((inst) => (
                    <li
                      key={inst.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Avatar className="h-5 w-5">
                        {inst.accountAvatarUrl && (
                          <AvatarImage
                            src={inst.accountAvatarUrl}
                            alt={inst.accountLogin}
                          />
                        )}
                        <AvatarFallback className="text-[9px]">
                          {inst.accountLogin.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>

                      <span className="font-medium">{inst.accountLogin}</span>

                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {inst.accountType}
                      </Badge>

                      {inst.suspendedAt && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-yellow-600">
                          Suspended
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Linked repos */}
            {linkedRepos.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("linkedRepos")}
                </h4>
                <ul className="space-y-1" aria-label="Linked repositories">
                  {linkedRepos.map((repo) => (
                    <li
                      key={repo.repoId}
                      className="text-sm text-muted-foreground"
                    >
                      {repo.githubRepoFullName}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {installations.length === 0 && linkedRepos.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("connectedNoData")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
