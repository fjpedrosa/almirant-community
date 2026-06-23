"use client";

import { RoadmapPageContainer } from "@/domains/projects/presentation/containers/roadmap-page-container";
import { BetaGate } from "@/domains/shared/presentation/components/beta-gate";

export default function RoadmapPage() {
  return (
    <BetaGate flagKey="beta-roadmap">
      <RoadmapPageContainer />
    </BetaGate>
  );
}
