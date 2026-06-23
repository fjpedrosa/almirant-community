"use client";

import { Suspense } from "react";
import { SidebarContentSkeleton } from "@/components/skeletons";
import { DocsPageContainer } from "@/domains/documents/presentation/containers/docs-page-container";
import { BetaGate } from "@/domains/shared/presentation/components/beta-gate";

export default function DocsPage() {
  return (
    <BetaGate flagKey="beta-docs">
      <Suspense fallback={<SidebarContentSkeleton />}>
        <DocsPageContainer />
      </Suspense>
    </BetaGate>
  );
}
