import { Check, Terminal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";

interface CopyPromptButtonProps {
  onCopy: () => void;
  isCopying: boolean;
  showSuccess?: boolean;
  disabled?: boolean;
  className?: string;
}

export const CopyPromptButton: React.FC<CopyPromptButtonProps> = ({
  onCopy,
  isCopying,
  showSuccess,
  disabled,
  className,
}) => {
  const t = useTranslations("workItems.prompt");
  const tooltipText = isCopying
    ? t("copying")
    : showSuccess
      ? t("copied")
      : t("copyAsPrompt");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={className}
          onClick={onCopy}
          disabled={disabled || isCopying}
          aria-label={tooltipText}
        >
          {isCopying ? (
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
          ) : showSuccess ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Terminal className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
};
