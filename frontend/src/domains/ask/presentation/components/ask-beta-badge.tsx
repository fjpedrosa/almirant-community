import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Component: AskBetaBadge
// ---------------------------------------------------------------------------
// Small badge indicating that the Ask feature is in beta.
// ---------------------------------------------------------------------------

export const AskBetaBadge: React.FC = () => {
  return (
    <Badge
      variant="outline"
      className="gap-1 border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-400"
    >
      <FlaskConical className="size-3" />
      Beta
    </Badge>
  );
};
