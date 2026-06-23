"use client";

import { useTranslations } from "next-intl";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import type { DocumentContentViewProps } from "../../domain/types";

export const DocumentContentView: React.FC<DocumentContentViewProps> = ({ content, components }) => {
  const t = useTranslations("documents");

  return (
    <ScrollArea className="flex-1 min-h-0 p-6">
      <MarkdownPreview
        content={content || t("noContentYet")}
        size="sm"
        components={components}
      />
    </ScrollArea>
  );
};
