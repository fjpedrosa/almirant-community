"use client";

import { IdeasPageContainer } from "@/domains/ideas/presentation/containers/ideas-page-container";
import { BetaGate } from "@/domains/shared/presentation/components/beta-gate";

export default function IdeasPage() {
  return (
    <BetaGate flagKey="beta-ideas">
      <IdeasPageContainer />
    </BetaGate>
  );
}
