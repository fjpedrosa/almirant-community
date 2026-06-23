"use client";

import { GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GithubSettingsContainer } from "@/domains/github/presentation/containers/github-settings-container";
import { SettingsPageShell } from "../../components/settings-page-shell";

const GitLabIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    role="img"
    aria-label="GitLab"
  >
    <path
      d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51a.42.42 0 0 1 .82 0l2.44 7.51h8.06l2.44-7.51a.42.42 0 0 1 .82 0l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.94z"
      fill="#E24329"
    />
    <path d="M12 22.13L16.03 10.16H7.97L12 22.13z" fill="#FC6D26" />
    <path d="M12 22.13L7.97 10.16H1.69L12 22.13z" fill="#FCA326" />
    <path d="M1.69 10.16l-1.22 3.78a.84.84 0 0 0 .3.94L12 22.13 1.69 10.16z" fill="#E24329" />
    <path d="M1.69 10.16h6.28L5.53 2.65a.42.42 0 0 0-.82 0L1.69 10.16z" fill="#FC6D26" />
    <path d="M12 22.13l4.03-11.97h6.28L12 22.13z" fill="#FCA326" />
    <path d="M22.31 10.16l1.22 3.78a.84.84 0 0 1-.3.94L12 22.13l10.31-11.97z" fill="#E24329" />
    <path d="M22.31 10.16h-6.28l2.44-7.51a.42.42 0 0 1 .82 0l3.02 7.51z" fill="#FC6D26" />
  </svg>
);

export const CodeProvidersSettingsContainer: React.FC = () => {
  const tSections = useTranslations("settings.sections");
  const tCodeProviders = useTranslations("settings.codeProviders");

  return (
    <SettingsPageShell
      title={
        <>
          <GitBranch className="h-5 w-5 text-muted-foreground" />
          {tSections("codeProviders")}
        </>
      }
      description={tCodeProviders("description")}
    >
      <GithubSettingsContainer className="rounded-lg border bg-card p-4" />

      <Card className="opacity-80">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border bg-muted/50">
                <GitLabIcon className="h-4 w-4" />
              </span>
              GitLab
            </CardTitle>
            <Badge variant="outline">{tCodeProviders("comingSoon")}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{tCodeProviders("gitlabDescription")}</p>
          <p className="text-xs">{tCodeProviders("gitlabReserved")}</p>
        </CardContent>
      </Card>
    </SettingsPageShell>
  );
};
