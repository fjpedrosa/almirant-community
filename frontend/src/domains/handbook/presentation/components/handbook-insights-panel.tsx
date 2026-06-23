"use client";

import { Inbox, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HandbookCaptureProposal, HandbookSearchResult } from "../../domain/types";

interface HandbookInsightsPanelProps {
  searchResults: HandbookSearchResult[];
  proposals: HandbookCaptureProposal[];
  isSearching: boolean;
  onApproveProposal: (id: string) => void;
  onRejectProposal: (id: string) => void;
}

export const HandbookInsightsPanel: React.FC<HandbookInsightsPanelProps> = ({
  searchResults,
  proposals,
  isSearching,
  onApproveProposal,
  onRejectProposal,
}) => (
  <aside className="hidden h-full min-h-0 w-[340px] flex-col gap-4 overflow-y-auto border-l bg-card p-4 xl:flex">
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Search className="h-4 w-4 text-primary" />
          Search matches
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isSearching ? (
          <p className="text-sm text-muted-foreground">Searching...</p>
        ) : searchResults.length === 0 ? (
          <p className="text-sm text-muted-foreground">Search with at least two characters to see matching chunks.</p>
        ) : (
          searchResults.slice(0, 5).map((result) => (
            <div key={`${result.entryId}-${result.headingPath}`} className="rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">{result.category}</Badge>
                <span className="text-xs text-muted-foreground">{result.headingPath}</span>
              </div>
              <h3 className="mt-2 text-sm font-medium">{result.title}</h3>
              <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{result.content}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>

    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Inbox className="h-4 w-4 text-primary" />
          Capture inbox
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending capture proposals.</p>
        ) : (
          proposals.map((proposal) => (
            <div key={proposal.id} className="rounded-lg border p-3">
              <Badge variant="outline" className="text-[10px]">{proposal.category}</Badge>
              <h3 className="mt-2 text-sm font-medium">{proposal.title}</h3>
              {proposal.summary && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{proposal.summary}</p>}
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => onApproveProposal(proposal.id)}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => onRejectProposal(proposal.id)}>Reject</Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  </aside>
);
