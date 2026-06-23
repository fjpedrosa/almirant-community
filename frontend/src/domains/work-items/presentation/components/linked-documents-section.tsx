import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { FileText, X, Plus, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { LinkedDocumentsSectionProps } from "../../domain/types";

export const LinkedDocumentsSection: React.FC<LinkedDocumentsSectionProps> = ({
  documents,
  isLoading,
  availableDocuments,
  onLinkDocument,
  onUnlinkDocument,
  isLinking,
}) => {
  const t = useTranslations("workItems.linkedDocuments");
  const [search, setSearch] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);

  const existingDocIds = new Set(documents.map((d) => d.id));

  const filteredDocs = availableDocuments.filter((doc) => {
    if (existingDocIds.has(doc.id)) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return doc.title.toLowerCase().includes(q);
  });

  const handleSelect = (documentId: string) => {
    onLinkDocument(documentId);
    setSearch("");
    setPopoverOpen(false);
  };

  if (isLoading) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-end">
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 max-md:h-8 max-md:w-8"
              title={t("add")}
              aria-label={t("add")}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-2" align="end">
            <Input
              placeholder={t("searchDocument")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm mb-2"
              autoFocus
            />
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {isLinking && (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              )}
              {!isLinking && filteredDocs.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-3">
                  {t("noDocuments")}
                </p>
              )}
              {!isLinking &&
                filteredDocs.slice(0, 20).map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    className="w-full text-left px-2 py-1.5 rounded-sm text-sm hover:bg-accent flex items-center gap-2"
                    onClick={() => handleSelect(doc.id)}
                  >
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{doc.title}</span>
                    {doc.projectName && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {doc.projectName}
                      </span>
                    )}
                  </button>
                ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Linked documents list */}
      {documents.length > 0 && (
        <div className="space-y-1">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-2 text-sm bg-muted/50 rounded px-2 py-1 group"
            >
              <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="truncate flex-1">{doc.title}</span>
              {doc.projectName && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {doc.projectName}
                </span>
              )}
              <button
                type="button"
                className="touch-visible text-muted-foreground hover:text-destructive"
                onClick={() => onUnlinkDocument(doc.id)}
                title={t("unlink")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
