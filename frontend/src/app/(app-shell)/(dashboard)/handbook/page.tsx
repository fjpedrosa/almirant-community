"use client";

import { Suspense } from "react";
import { SidebarContentSkeleton } from "@/components/skeletons";
import { HandbookPageContainer } from "@/domains/handbook/presentation/containers/handbook-page-container";

export default function HandbookPage() {
  return (
    <Suspense fallback={<SidebarContentSkeleton />}>
      <HandbookPageContainer />
    </Suspense>
  );
}
