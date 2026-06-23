"use client";

import { HandbookEntryDetail } from "../components/handbook-entry-detail";
import { HandbookEntryList } from "../components/handbook-entry-list";
import { HandbookInsightsPanel } from "../components/handbook-insights-panel";
import { useHandbookPage } from "../../application/hooks/use-handbook-page";

export const HandbookPageContainer: React.FC = () => {
  const handbook = useHandbookPage();

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 w-full overflow-hidden bg-background">
      <HandbookEntryList
        entries={handbook.entries}
        selectedEntryId={handbook.selectedEntry?.id ?? null}
        categories={handbook.categories}
        search={handbook.search}
        selectedCategory={handbook.selectedCategory}
        isLoading={handbook.isLoading}
        isImporting={handbook.isImporting}
        onSearchChange={handbook.onSearchChange}
        onCategoryChange={handbook.onCategoryChange}
        onSelectEntry={handbook.onSelectEntry}
        onImportDefault={handbook.onImportDefault}
      />
      <HandbookEntryDetail entry={handbook.selectedEntry} />
      <HandbookInsightsPanel
        searchResults={handbook.searchResults}
        proposals={handbook.proposals}
        isSearching={handbook.isSearching}
        onApproveProposal={handbook.onApproveProposal}
        onRejectProposal={handbook.onRejectProposal}
      />
    </div>
  );
};
