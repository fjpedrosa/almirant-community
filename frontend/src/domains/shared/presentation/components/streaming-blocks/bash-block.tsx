import { Terminal } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";
import { unwrapShellCommand } from "@/domains/shared/application/utils/shell-command-display";

interface BashBlockProps {
  command: string;
  description?: string;
  output?: string;
}

export const BashBlock: React.FC<BashBlockProps> = ({
  command,
  description,
  output,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const displayCommand = unwrapShellCommand(command);

  // Show short commands inline only when there is no output to inspect
  const isShort = displayCommand.length <= 60 && !output;

  if (isShort) {
    return (
      <div className="flex items-center gap-2 py-0.5 px-2 text-base">
        <Terminal className="size-3.5 text-muted-foreground" />
        <code className="font-mono text-foreground/70 truncate">{displayCommand}</code>
        {description && (
          <span className="text-muted-foreground/50 truncate">
            {description}
          </span>
        )}
      </div>
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={() => setIsOpen(!isOpen)}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 py-0.5 px-2 text-base text-muted-foreground hover:text-foreground transition-colors"
        >
          <Terminal className="size-3.5" />
          <span className="font-medium truncate">
            {description ?? (displayCommand.length > 50 ? `${displayCommand.slice(0, 50)}...` : displayCommand)}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 ml-6 text-sm font-mono text-foreground/70 bg-muted/40 rounded px-2 py-1.5 overflow-x-auto max-w-full whitespace-pre-wrap break-all">
          {displayCommand}
          {output ? `\n\n${output}` : ""}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
};
