import React from "react";
import { ChevronRight, FileText, Folder, Loader2, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { DynamicIcon, hasIcon } from "@/lib/icon-map";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  DocumentTreeSidebarProps,
  DocumentTreeFolder,
  DocumentTreeFile,
  DocumentTreeNode,
} from "../../domain/types";

const TruncatedText: React.FC<{ text: string; className?: string }> = ({
  text,
  className,
}) => {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [open, setOpen] = React.useState(false);

  const isTruncated = () =>
    !!ref.current && ref.current.scrollWidth > ref.current.clientWidth;

  const handleOpenChange = (next: boolean) => {
    setOpen(next && isTruncated());
  };

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange} delayDuration={300}>
      <TooltipTrigger asChild>
        <span ref={ref} className={className}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" align="start" avoidCollisions={false}>
        <p>{text}</p>
      </TooltipContent>
    </Tooltip>
  );
};

interface TreeFolderItemProps {
  folder: DocumentTreeFolder;
  expandedFolders: Set<string>;
  selectedDocumentId: string | null;
  onToggleFolder: (folderId: string) => void;
  onSelectDocument: (documentId: string) => void;
  onToggleFavorite: (documentId: string) => void;
}

const TreeFolderItem: React.FC<TreeFolderItemProps> = ({
  folder,
  expandedFolders,
  selectedDocumentId,
  onToggleFolder,
  onSelectDocument,
  onToggleFavorite,
}) => {
  const isExpanded = expandedFolders.has(folder.id);

  return (
    <div>
      <button
        onClick={() => onToggleFolder(folder.id)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors group min-w-0"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform",
            isExpanded && "rotate-90"
          )}
        />
        {hasIcon(folder.icon) ? (
          <DynamicIcon
            name={folder.icon}
            className="h-4 w-4 shrink-0"
            style={{ color: folder.color }}
          />
        ) : (
          <Folder
            className="h-4 w-4 shrink-0"
            style={{ color: folder.color }}
          />
        )}
        <span className="text-sm font-medium truncate min-w-0">{folder.name}</span>
        {folder.unreadCount > 0 && (
          <Badge
            variant="default"
            className="text-[11px] px-1.5 py-0 h-4 shrink-0"
          >
            {folder.unreadCount}
          </Badge>
        )}
        <Badge
          variant="secondary"
          className="text-[10px] px-1.5 py-0 h-4 ml-auto shrink-0"
        >
          {folder.totalDocumentCount}
        </Badge>
      </button>

      {isExpanded && (
        <div className="ml-3 pl-2 border-l border-border/50">
          {folder.children.map((child) => (
            <TreeNodeItem
              key={child.id}
              node={child}
              expandedFolders={expandedFolders}
              selectedDocumentId={selectedDocumentId}
              onToggleFolder={onToggleFolder}
              onSelectDocument={onSelectDocument}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface TreeFileItemProps {
  file: DocumentTreeFile;
  isSelected: boolean;
  onSelect: () => void;
  onToggleFavorite: (documentId: string) => void;
}

const TreeFileItem: React.FC<TreeFileItemProps> = ({
  file,
  isSelected,
  onSelect,
  onToggleFavorite,
}) => {
  return (
    <div
      className={cn(
        "group group/file w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors text-left overflow-hidden",
        isSelected
          ? "bg-primary/10 text-primary"
          : "hover:bg-accent/50 text-foreground"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
      >
        {!file.isRead && (
          <div className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse" />
        )}
        <FileText
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isSelected ? "text-primary" : "text-muted-foreground"
          )}
        />
        <TruncatedText
          text={file.title}
          className="text-sm truncate flex-1 min-w-0"
        />
      </button>
      <button
        type="button"
        aria-label={file.isFavorited ? "Remove from favorites" : "Add to favorites"}
        onClick={() => onToggleFavorite(file.id)}
        className={cn(
          "shrink-0 w-5 h-5 flex items-center justify-center rounded-sm transition-all",
          file.isFavorited
            ? "opacity-100 text-yellow-500"
            : "touch-visible text-muted-foreground hover:text-yellow-500"
        )}
      >
        <Star
          className="h-3.5 w-3.5"
          fill={file.isFavorited ? "currentColor" : "none"}
        />
      </button>
    </div>
  );
};

interface TreeNodeItemProps {
  node: DocumentTreeNode;
  expandedFolders: Set<string>;
  selectedDocumentId: string | null;
  onToggleFolder: (folderId: string) => void;
  onSelectDocument: (documentId: string) => void;
  onToggleFavorite: (documentId: string) => void;
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = ({
  node,
  expandedFolders,
  selectedDocumentId,
  onToggleFolder,
  onSelectDocument,
  onToggleFavorite,
}) => {
  if (node.type === "folder") {
    return (
      <TreeFolderItem
        folder={node}
        expandedFolders={expandedFolders}
        selectedDocumentId={selectedDocumentId}
        onToggleFolder={onToggleFolder}
        onSelectDocument={onSelectDocument}
        onToggleFavorite={onToggleFavorite}
      />
    );
  }

  return (
    <TreeFileItem
      file={node}
      isSelected={node.id === selectedDocumentId}
      onSelect={() => onSelectDocument(node.id)}
      onToggleFavorite={onToggleFavorite}
    />
  );
};

export const DocumentTreeSidebar: React.FC<DocumentTreeSidebarProps> = ({
  tree,
  selectedDocumentId,
  expandedFolders,
  onToggleFolder,
  onSelectDocument,
  onToggleFavorite,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">No documents found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
      <div className="p-2 space-y-0.5">
        {tree.map((node) => (
          <TreeNodeItem
            key={node.id}
            node={node}
            expandedFolders={expandedFolders}
            selectedDocumentId={selectedDocumentId}
            onToggleFolder={onToggleFolder}
            onSelectDocument={onSelectDocument}
            onToggleFavorite={onToggleFavorite}
          />
        ))}
      </div>
    </div>
  );
};
