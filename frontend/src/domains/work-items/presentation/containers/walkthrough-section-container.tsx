"use client";

import { useState } from "react";
import type { WorkItem, WalkthroughRecording } from "../../domain/types";
import { useWalkthroughActions } from "../../application/hooks/use-walkthrough";
import { WalkthroughSection } from "../components/walkthrough-section";

interface WalkthroughSectionContainerProps {
  workItem: WorkItem;
}

export const WalkthroughSectionContainer: React.FC<WalkthroughSectionContainerProps> = ({
  workItem,
}) => {
  const [selectedRecording, setSelectedRecording] = useState<WalkthroughRecording | null>(null);

  const {
    walkthroughStatus,
    currentScript,
    recordings,
    canStart,
    isStarting,
    startWalkthrough,
  } = useWalkthroughActions(workItem);

  return (
    <WalkthroughSection
      status={walkthroughStatus}
      currentScript={currentScript}
      recordings={recordings}
      canStart={canStart}
      isStarting={isStarting}
      onStart={startWalkthrough}
      selectedRecording={selectedRecording}
      onSelectRecording={setSelectedRecording}
    />
  );
};
