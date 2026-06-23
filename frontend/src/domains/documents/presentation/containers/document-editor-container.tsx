"use client";

import { useDocumentEditor } from "../../application/hooks/use-document-editor";
import { DocumentEditor } from "../components/document-editor";

interface DocumentEditorContainerProps {
  documentId: string;
  initialContent: string;
}

export const DocumentEditorContainer: React.FC<DocumentEditorContainerProps> = ({
  documentId,
  initialContent,
}) => {
  const { content, handleContentChange } = useDocumentEditor(documentId, initialContent);

  return <DocumentEditor content={content} onChange={handleContentChange} />;
};
