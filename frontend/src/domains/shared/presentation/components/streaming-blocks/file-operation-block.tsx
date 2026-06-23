import { Eye, Pencil, FilePlus } from "lucide-react";

interface FileOperationBlockProps {
  filePath: string;
  operation: "read" | "write" | "edit";
  lineRange?: string;
}

const OperationIcon: React.FC<{ operation: FileOperationBlockProps["operation"] }> = ({ operation }) => {
  switch (operation) {
    case "read":
      return <Eye className="size-3.5 text-blue-400" />;
    case "edit":
      return <Pencil className="size-3.5 text-amber-400" />;
    case "write":
      return <FilePlus className="size-3.5 text-green-400" />;
  }
};

export const FileOperationBlock: React.FC<FileOperationBlockProps> = ({
  filePath,
  operation,
  lineRange,
}) => {
  // Extract just the filename for compact display
  const fileName = filePath.split("/").pop() ?? filePath;
  const dirPath = filePath.includes("/")
    ? filePath.slice(0, filePath.lastIndexOf("/") + 1)
    : "";

  return (
    <div className="flex items-center gap-2 py-0.5 px-2 text-base text-muted-foreground">
      <OperationIcon operation={operation} />
      <span className="truncate">
        {dirPath && <span className="text-muted-foreground/50">{dirPath}</span>}
        <span className="font-medium text-foreground/70">{fileName}</span>
        {lineRange && <span className="text-muted-foreground/40 ml-1">:{lineRange}</span>}
      </span>
    </div>
  );
};
