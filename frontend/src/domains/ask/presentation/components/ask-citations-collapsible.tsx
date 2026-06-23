import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  GitCommit,
  Calendar,
  CheckSquare,
  ExternalLink,
  Brain,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { AskCitation, AskCitationSourceType } from "../../domain/types";

// ---------------------------------------------------------------------------
// Component: AskCitationsCollapsible
// ---------------------------------------------------------------------------
// Collapsible list of citations rendered inline inside an assistant message.
// Replaces the standalone AskCitationsList card.
// ---------------------------------------------------------------------------

export interface AskCitationsCollapsibleProps {
  citations: AskCitation[];
  /** Controlled open state (optional — falls back to internal state) */
  isOpen?: boolean;
  /** Controlled toggle handler */
  onToggle?: () => void;
}

const sourceTypeIcons: Record<AskCitationSourceType, React.ReactNode> = {
  work_item: <CheckSquare className="size-3" />,
  document: <FileText className="size-3" />,
  event: <Calendar className="size-3" />,
  commit: <GitCommit className="size-3" />,
  observation: <Brain className="size-3" />,
};

const sourceTypeClassNames: Record<AskCitationSourceType, string> = {
  work_item:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  document:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  event:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  commit: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  observation:
    "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
};

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

export const AskCitationsCollapsible: React.FC<
  AskCitationsCollapsibleProps
> = ({ citations, isOpen: controlledIsOpen, onToggle }) => {
  const t = useTranslations("ask");
  const [internalIsOpen, setInternalIsOpen] = useState(false);

  const isControlled = controlledIsOpen !== undefined;
  const isOpen = isControlled ? controlledIsOpen : internalIsOpen;
  const handleOpenChange = (open: boolean) => {
    if (isControlled) {
      onToggle?.();
    } else {
      setInternalIsOpen(open);
    }
  };

  if (citations.length === 0) {
    return null;
  }

  return (
    <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mt-3 group">
        <span>
          {t("citations.title", { count: citations.length })}
        </span>
        {isOpen ? (
          <ChevronUp className="size-3" />
        ) : (
          <ChevronDown className="size-3" />
        )}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <ul className="mt-2 space-y-2">
          {citations.map((citation, index) => (
            <CitationItem
              key={`${citation.sourceType}-${citation.sourceId}`}
              citation={citation}
              index={index + 1}
              viewAriaLabel={t("citations.viewAriaLabel", {
                title: citation.title,
              })}
              sourceLabel={t(
                `citations.sourceTypes.${citation.sourceType}`
              )}
            />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
};

// ---------------------------------------------------------------------------
// Sub-component: CitationItem
// ---------------------------------------------------------------------------

interface CitationItemProps {
  citation: AskCitation;
  index: number;
  viewAriaLabel: string;
  sourceLabel: string;
}

const CitationItem: React.FC<CitationItemProps> = ({
  citation,
  index,
  viewAriaLabel,
  sourceLabel,
}) => {
  const sourceType = citation.sourceType;

  return (
    <li className="group flex gap-2 rounded-md border border-border/50 p-2 transition-colors hover:bg-accent/50 text-xs">
      <div className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
        {index}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="secondary"
              className={cn(
                "gap-0.5 text-xs py-0 h-4",
                sourceTypeClassNames[sourceType]
              )}
            >
              {sourceTypeIcons[sourceType]}
              {sourceLabel}
            </Badge>
            <span className="text-muted-foreground">
              {formatTimestamp(citation.timestamp)}
            </span>
          </div>
          <button
            type="button"
            className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            aria-label={viewAriaLabel}
          >
            <ExternalLink className="size-3 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
        <h4 className="mt-0.5 font-medium line-clamp-1">{citation.title}</h4>
        {citation.excerpt && (
          <p className="mt-0.5 text-muted-foreground line-clamp-2">
            {citation.excerpt}
          </p>
        )}
      </div>
    </li>
  );
};
