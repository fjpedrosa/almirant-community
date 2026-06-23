"use client";

import { GoalsPageContainer } from "@/domains/goals/presentation/containers/goals-page-container";
import { BetaGate } from "@/domains/shared/presentation/components/beta-gate";

export default function GoalsPage() {
  return (
    <BetaGate flagKey="beta-goals">
      <GoalsPageContainer />
    </BetaGate>
  );
}
