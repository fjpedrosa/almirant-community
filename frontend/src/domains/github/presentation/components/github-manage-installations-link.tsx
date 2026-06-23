import { useTranslations } from "next-intl";
import { ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GithubManageInstallationsLinkProps } from "../../domain/types";

const GITHUB_INSTALLATIONS_URL = "https://github.com/settings/installations";

export const GithubManageInstallationsLink: React.FC<
  GithubManageInstallationsLinkProps
> = ({ canAddRepositories = false, onAddRepositories }) => {
  const t = useTranslations("github");

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canAddRepositories && onAddRepositories && (
        <Button type="button" size="sm" onClick={onAddRepositories}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("addRepositories")}
        </Button>
      )}
      <a
        href={GITHUB_INSTALLATIONS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {t("manageInstallations")}
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </div>
  );
};
