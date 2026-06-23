"use client";

import { useState } from "react";
import {
  isDodHumanActionV2,
  type DodHumanActionV2,
} from "../../domain/dod-human-action";
import { useApplyDodHumanAction } from "../../application/hooks/use-dod-human-action";
import { DodHumanActionPanel } from "../components/dod-human-action-panel";

export interface DodHumanActionPanelContainerProps {
  workItemId: string;
  /**
   * The raw `metadata.dod_human_action_v2` field from the work item. The
   * container validates the shape with isDodHumanActionV2 before mounting
   * the presentational component.
   */
  payload: unknown;
}

/**
 * Smart wrapper around DodHumanActionPanel: validates the raw metadata
 * payload, owns the mutation state, and forwards apply intents to the
 * mutation hook. Mount this directly inside the work-item detail view
 * gated by `metadata.dod_human_action_required`.
 */
export const DodHumanActionPanelContainer = ({
  workItemId,
  payload,
}: DodHumanActionPanelContainerProps) => {
  const apply = useApplyDodHumanAction();
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);

  if (!isDodHumanActionV2(payload)) return null;
  const validated: DodHumanActionV2 = payload;

  const handleApply = (optionId: string) => {
    if (apply.isPending) return;
    setPendingOptionId(optionId);
    apply.mutate(
      { workItemId, optionId },
      {
        onSettled: () => setPendingOptionId(null),
      },
    );
  };

  return (
    <DodHumanActionPanel
      payload={validated}
      applyingOptionId={pendingOptionId}
      isSubmitting={apply.isPending}
      onApply={handleApply}
    />
  );
};
