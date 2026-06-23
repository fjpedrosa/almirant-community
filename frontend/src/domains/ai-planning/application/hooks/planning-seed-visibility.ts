export const shouldShowPlanningSeedContext = ({
  attachedSeedCount,
  isSessionActive,
  hasInjectedSeeds,
  isStarting,
  phase,
  hasStartedConversation,
}: {
  attachedSeedCount: number;
  isSessionActive: boolean;
  hasInjectedSeeds: boolean;
  isStarting: boolean;
  phase: string;
  hasStartedConversation: boolean;
}) =>
  attachedSeedCount > 0 &&
  !hasInjectedSeeds &&
  !isStarting &&
  phase !== "completed" &&
  (!isSessionActive || !hasStartedConversation);
