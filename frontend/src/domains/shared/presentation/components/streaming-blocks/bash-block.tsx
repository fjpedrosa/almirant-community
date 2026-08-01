"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { unwrapShellCommand } from "@/domains/shared/application/utils/shell-command-display";
import { getToolNameColor } from "./tool-icon";

interface BashBlockProps {
  command: string;
  description?: string;
  output?: string;
}

/** Shell one-liners are frequently heredocs or pipelines several hundred
 *  characters long. Show the head of the actual command — never a bare
 *  "Terminal" label — so the row still says what the agent ran. */
const buildSummary = (command: string): string =>
  command.replace(/\s+/g, " ").trim();

export const BashBlock: React.FC<BashBlockProps> = ({
  command,
  description,
  output,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const displayCommand = unwrapShellCommand(command);
  const summary = buildSummary(displayCommand);
  const nameColor = getToolNameColor("Bash");

  const isExpandable = output != null || summary.length > 72;

  const header = (
    <>
      <Terminal className={cn("size-4 flex-shrink-0", nameColor)} />
      <span
        className={cn("font-sans font-semibold whitespace-nowrap", nameColor)}
      >
        Terminal
      </span>
      <code className="truncate font-mono text-sm text-foreground/70">
        {summary}
      </code>
      {description && (
        <span className="hidden shrink-0 truncate font-sans text-sm text-muted-foreground/60 sm:inline">
          {description}
        </span>
      )}
    </>
  );

  if (!isExpandable) {
    return (
      <div className="flex items-center gap-2 rounded-md px-1 py-0.5 text-[0.9375rem]">
        {header}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-[0.9375rem] transition-colors hover:bg-muted/40"
      >
        {isOpen ? (
          <ChevronDown className="size-3.5 flex-shrink-0 text-foreground/50" />
        ) : (
          <ChevronRight className="size-3.5 flex-shrink-0 text-foreground/50" />
        )}
        {header}
      </button>
      {isOpen && (
        <pre className="mt-1 ml-6 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 font-mono text-sm text-foreground/80">
          {displayCommand}
          {output ? `\n\n${output}` : ""}
        </pre>
      )}
    </div>
  );
};
