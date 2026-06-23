export type HandbookEntryStatus = "draft" | "verified" | "deprecated";
export type HandbookEntrySourceType = "import" | "agent_capture" | "manual";
export type HandbookCaptureProposalStatus = "pending" | "approved" | "rejected";

export interface HandbookEntry {
  id: string;
  organizationId: string;
  title: string;
  slug: string;
  summary: string | null;
  content: string;
  category: string;
  status: HandbookEntryStatus;
  sourceType: HandbookEntrySourceType;
  sourcePath: string | null;
  sourceProjectId: string | null;
  contentHash: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  sourceProjectName?: string | null;
  sourceProjectColor?: string | null;
}

export interface HandbookSearchResult {
  entryId: string;
  title: string;
  slug: string;
  summary: string | null;
  category: string;
  status: HandbookEntryStatus;
  headingPath: string | null;
  content: string;
  rank: number;
}

export interface HandbookCategorySummary {
  category: string;
  count: number;
}

export interface HandbookCaptureProposal {
  id: string;
  organizationId: string;
  title: string;
  slug: string;
  summary: string | null;
  proposedContent: string;
  category: string;
  rationale: string | null;
  status: HandbookCaptureProposalStatus;
  sourceFiles: string[] | null;
  targetEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HandbookImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  entries: HandbookEntry[];
}

export interface CreateHandbookProposalRequest {
  title: string;
  proposedContent: string;
  slug?: string;
  summary?: string | null;
  category?: string;
  rationale?: string | null;
  sourceProjectId?: string | null;
  sourceFiles?: string[];
  targetEntryId?: string | null;
}

export interface HandbookPageState {
  entries: HandbookEntry[];
  selectedEntry: HandbookEntry | null;
  searchResults: HandbookSearchResult[];
  proposals: HandbookCaptureProposal[];
  categories: HandbookCategorySummary[];
  search: string;
  selectedCategory: string;
  isLoading: boolean;
  isImporting: boolean;
  isSearching: boolean;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onSelectEntry: (entry: HandbookEntry) => void;
  onImportDefault: () => void;
  onApproveProposal: (id: string) => void;
  onRejectProposal: (id: string) => void;
}
