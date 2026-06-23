import { Check, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";

interface CopyCliCommandButtonProps {
  command: string;
  onCopy: () => void;
  copied: boolean;
  disabled?: boolean;
  className?: string;
}

export const CopyCliCommandButton: React.FC<CopyCliCommandButtonProps> = ({
  command,
  onCopy,
  copied,
  disabled,
  className,
}) => {
  const t = useTranslations("workItems.card");
  const tooltipText = copied ? t("commandCopied") : command;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={className}
          onClick={onCopy}
          disabled={disabled}
          aria-label={copied ? "Command copied" : "Copy command"}
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <TerminalSquare className="h-4 w-4 text-muted-foreground" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <code className="text-xs">{tooltipText}</code>
      </TooltipContent>
    </Tooltip>
  );
};
