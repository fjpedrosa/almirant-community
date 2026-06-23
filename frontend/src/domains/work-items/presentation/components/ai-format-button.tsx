import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";

interface AiFormatButtonProps {
  onFormat: () => void;
  isFormatting: boolean;
  disabled?: boolean;
  className?: string;
}

export const AiFormatButton: React.FC<AiFormatButtonProps> = ({
  onFormat,
  isFormatting,
  disabled,
  className,
}) => {
  const t = useTranslations("workItems.ai");
  const tooltipText = isFormatting ? t("formatting") : t("format");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className}
          onClick={onFormat}
          disabled={disabled || isFormatting}
          aria-label={tooltipText}
        >
          {isFormatting ? (
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
};
