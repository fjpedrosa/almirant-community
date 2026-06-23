"use client";

import { use } from "react";
import { DocumentViewerContainer } from "@/domains/documents/presentation/containers/document-viewer-container";
import { BetaGate } from "@/domains/shared/presentation/components/beta-gate";

export default function DocumentViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { documentId } = use(params);
  const { version } = use(searchParams);

  return (
    <BetaGate flagKey="beta-docs">
      <DocumentViewerContainer
        documentId={documentId}
        versionHash={version ?? null}
      />
    </BetaGate>
  );
}
