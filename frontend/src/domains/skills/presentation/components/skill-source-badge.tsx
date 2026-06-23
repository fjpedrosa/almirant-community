import { Badge } from "@/components/ui/badge";
import type { SkillSourceBadgeProps } from "../../domain/types";

const SOURCE_CONFIG = {
  official: {
    label: "Official",
    className: "bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-300",
  },
  custom: {
    label: "Custom",
    className: "bg-purple-100 text-purple-800 hover:bg-purple-100 dark:bg-purple-900 dark:text-purple-300",
  },
  repo: {
    label: "Repo",
    className: "bg-orange-100 text-orange-800 hover:bg-orange-100 dark:bg-orange-900 dark:text-orange-300",
  },
} as const;

export const SkillSourceBadge = ({ source }: SkillSourceBadgeProps) => {
  const config = SOURCE_CONFIG[source];

  return (
    <Badge variant="secondary" className={config.className}>
      {config.label}
    </Badge>
  );
};
