"use client";

import dynamic from "next/dynamic";
import type { DocumentEditorProps } from "../../domain/types";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

export const DocumentEditor: React.FC<DocumentEditorProps> = ({ content, onChange }) => {
  return (
    <div className="flex-1 [&_.w-md-editor]:!bg-background [&_.w-md-editor]:!border-border [&_.w-md-editor-text-pre>code]:!text-foreground [&_.w-md-editor-text-input]:!text-foreground [&_.wmde-markdown]:!bg-background [&_.wmde-markdown]:!text-foreground" data-color-mode="dark">
      <MDEditor
        value={content}
        onChange={(val) => onChange(val || "")}
        height="100%"
        preview="edit"
        hideToolbar={false}
        visibleDragbar={false}
      />
    </div>
  );
};
