"use client";

import { AddProviderPanelSheet } from "../components/add-provider-panel-sheet";
import type { UseAddProviderPanelReturn } from "../../domain/types";

// ---------------------------------------------------------------------------
// Props interface
// ---------------------------------------------------------------------------

export type AddProviderPanelContainerProps = UseAddProviderPanelReturn;

// ---------------------------------------------------------------------------
// AddProviderPanelContainer - Wires hook output to presentational component
// ---------------------------------------------------------------------------
// Usage:
//   const addProviderPanel = useAddProviderPanel({ apiKeyForm, connections, aiScope });
//   <AddProviderPanelContainer {...addProviderPanel} />
// ---------------------------------------------------------------------------

export const AddProviderPanelContainer: React.FC<AddProviderPanelContainerProps> = ({
  isOpen,
  availableProviders,
  close,
  handleSelectProvider,
}) => {
  return (
    <AddProviderPanelSheet
      open={isOpen}
      onOpenChange={(open) => { if (!open) close(); }}
      providers={availableProviders}
      onSelectProvider={handleSelectProvider}
    />
  );
};
