import { useTranslations } from "next-intl";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DocumentListItem } from "./document-list-item";
import type { DocumentWithCategory } from "../../domain/types";

interface DocumentListProps {
  documents: DocumentWithCategory[];
  selectedDocId: string | null;
  onDocumentSelect: (id: string) => void;
}

export const DocumentList: React.FC<DocumentListProps> = ({
  documents,
  selectedDocId,
  onDocumentSelect,
}) => {
  const t = useTranslations("documents");

  if (documents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">{t("noDocumentsFound")}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-2 space-y-0.5">
        {documents.map((doc) => (
          <DocumentListItem
            key={doc.id}
            id={doc.id}
            title={doc.title}
            categoryName={doc.categoryName}
            categoryColor={doc.categoryColor}
            categoryIcon={doc.categoryIcon}
            projectName={doc.projectName}
            projectColor={doc.projectColor}
            updatedAt={doc.updatedAt}
            wordCount={doc.wordCount}
            isSelected={doc.id === selectedDocId}
            onClick={() => onDocumentSelect(doc.id)}
          />
        ))}
      </div>
    </ScrollArea>
  );
};
