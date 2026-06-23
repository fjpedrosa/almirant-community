"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { MermaidAwareCodeBlock } from "@/domains/shared/presentation/components/mermaid-aware-code-block";
import { LightboxImage } from "@/domains/shared/presentation/components/lightbox-image";

interface ChangelogSection {
  heading: string;
  content: string;
}

const parseChangelogSections = (markdown: string): ChangelogSection[] => {
  const lines = markdown.split("\n");
  const sections: ChangelogSection[] = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentHeading || currentLines.length > 0) {
        sections.push({
          heading: currentHeading,
          content: currentLines.join("\n").trim(),
        });
      }
      currentHeading = line.replace(/^## /, "");
      currentLines = [];
    } else if (line.startsWith("# ")) {
      // Skip the h1 title — it's redundant with the card title
      continue;
    } else {
      currentLines.push(line);
    }
  }

  // Push last section
  if (currentHeading || currentLines.length > 0) {
    sections.push({
      heading: currentHeading,
      content: currentLines.join("\n").trim(),
    });
  }

  return sections.filter((s) => s.content.length > 0);
};

const richComponents = {
  pre: MermaidAwareCodeBlock,
  img: LightboxImage,
};

interface CollapsibleSectionProps {
  heading: string;
  content: string;
  defaultOpen: boolean;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  heading,
  content,
  defaultOpen,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-1.5 text-left group">
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
          {heading}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-5">
        <MarkdownPreview
          content={content}
          size="sm"
          components={richComponents}
        />
      </CollapsibleContent>
    </Collapsible>
  );
};

interface ChangelogContentProps {
  markdown: string;
}

export const ChangelogContent: React.FC<ChangelogContentProps> = ({
  markdown,
}) => {
  const sections = parseChangelogSections(markdown);

  // If no sections parsed (e.g. simple list without ## headers), render as plain markdown
  if (sections.length === 0 || (sections.length === 1 && !sections[0].heading)) {
    return (
      <MarkdownPreview
        content={markdown}
        size="sm"
        components={richComponents}
      />
    );
  }

  // If only one section with heading, render without collapsible
  if (sections.length === 1) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">
          {sections[0].heading}
        </p>
        <MarkdownPreview
          content={sections[0].content}
          size="sm"
          components={richComponents}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {sections.map((section, idx) =>
        section.heading ? (
          <CollapsibleSection
            key={`${section.heading}-${idx}`}
            heading={section.heading}
            content={section.content}
            defaultOpen={idx < 3}
          />
        ) : (
          <MarkdownPreview
            key={`no-heading-${idx}`}
            content={section.content}
            size="sm"
            components={richComponents}
          />
        ),
      )}
    </div>
  );
};
