import { useTranslations } from "next-intl";
import { Sprout, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatInputToolbarProps } from "../../domain/types";

// Usage:
// <ChatInputToolbar
//   onSeedsClick={() => setShowSeeds(true)}
//   attachedSeeds={[{ id: "1", title: "My seed" }]}
//   onRemoveSeed={(id) => handleRemove(id)}
// />

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "..." : text;
}

export const ChatInputToolbar: React.FC<ChatInputToolbarProps> = ({
  onSeedsClick,
  attachedSeeds = [],
  onRemoveSeed,
}) => {
  const t = useTranslations("aiPlanning");

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={onSeedsClick}
          >
            <Sprout className="size-3.5" />
            {t("seedsTab")}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">{t("seedsTab")}</TooltipContent>
      </Tooltip>

      {attachedSeeds.map((seed) => (
        <Badge
          key={seed.id}
          variant="secondary"
          className="group gap-1 pl-2 pr-1 text-xs font-normal"
        >
          <Sprout className="size-3 shrink-0 text-muted-foreground" />
          <span className="max-w-[200px] truncate" title={seed.title}>
            {truncate(seed.title, 30)}
          </span>
          {onRemoveSeed && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onRemoveSeed(seed.id)}
              className="size-6 text-muted-foreground touch-visible hover:text-destructive"
            >
              <X className="size-3" />
            </Button>
          )}
        </Badge>
      ))}
    </div>
  );
};
