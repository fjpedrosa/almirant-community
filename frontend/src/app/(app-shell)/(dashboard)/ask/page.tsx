"use client";

import { Suspense } from "react";
import { AskPageContainer } from "@/domains/ask/presentation/containers/ask-page-container";
import { BetaGate } from "@/domains/shared/presentation/components/beta-gate";

export default function AskPage() {
  return (
    <BetaGate flagKey="beta-ask">
      <Suspense>
        <AskPageContainer />
      </Suspense>
    </BetaGate>
  );
}
