import { GitBranch } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RepoSelectorProps } from "../../domain/types";

export const RepoSelector: React.FC<RepoSelectorProps> = ({
  repos,
  selectedRepoId,
  onSelect,
}) => {
  const t = useTranslations("agents");

  if (repos.length < 2) return null;

  return (
    <div className="flex flex-col gap-1">
      <div className="px-2 py-1 text-xs font-medium text-muted-foreground flex items-center gap-1">
        <GitBranch className="h-3 w-3" />
        {t("selectRepo")}
      </div>
      {repos.map((repo) => (
        <button
          key={repo.id}
          type="button"
          className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left ${
            selectedRepoId === repo.id ? "bg-accent font-medium" : ""
          }`}
          onClick={() => onSelect(repo.id)}
        >
          <span className="text-sm truncate">{repo.name}</span>
        </button>
      ))}
      <button
        type="button"
        className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left ${
          selectedRepoId === null ? "bg-accent font-medium" : ""
        }`}
        onClick={() => onSelect(null)}
      >
        <span className="text-sm text-muted-foreground">{t("defaultRepo")}</span>
      </button>
    </div>
  );
};
