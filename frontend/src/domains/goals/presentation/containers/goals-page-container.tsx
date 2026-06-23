"use client";

import { useGoalsReadiness } from "../../application/hooks/use-goals-readiness";
import { GoalsPage } from "../components/goals-page";

export const GoalsPageContainer: React.FC = () => {
  const goalsReadiness = useGoalsReadiness();

  return <GoalsPage {...goalsReadiness} />;
};
