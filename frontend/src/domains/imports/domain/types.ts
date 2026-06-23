import type { ImportStatus } from "@/domains/shared/domain/types";

// Import job entity
export interface ImportJob {
  id: string;
  fileName: string;
  status: ImportStatus;
  totalRows: number;
  processedRows: number;
  successCount: number;
  errorCount: number;
  errors: ImportError[];
  columnMapping: ColumnMapping;
  createdAt: Date;
  completedAt: Date | null;
}

// Import error
export interface ImportError {
  row: number;
  error: string;
}

// Column mapping (CSV column -> Lead field)
export interface ColumnMapping {
  [csvColumn: string]: LeadField | null;
}

// Available lead fields for mapping
export type LeadField =
  | "name"
  | "email"
  | "phone"
  | "company"
  | "position"
  | "source"
  | "profileUrl"
  | "notes"
  | `customFields.${string}`;

// CSV preview response
export interface CsvPreviewResponse {
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
  suggestedMapping: ColumnMapping;
}

// Start import request
export interface StartImportRequest {
  fileName: string;
  columnMapping: ColumnMapping;
  data: Record<string, string>[];
  tagIds?: string[];
}

// Import progress
export interface ImportProgress {
  jobId: string;
  status: ImportStatus;
  processedRows: number;
  totalRows: number;
  successCount: number;
  errorCount: number;
  progress: number; // 0-100
}

// ---- Presentation layer types ----

export type ImportStep = "upload" | "mapping" | "importing" | "completed";

export interface LeadFieldOption {
  value: LeadField | "skip";
  label: string;
}

export interface ImportResult {
  success: number;
  errors: number;
  total: number;
}

// Component props
export interface ImportUploadStepProps {
  getRootProps: () => Record<string, unknown>;
  getInputProps: () => Record<string, unknown>;
  isDragActive: boolean;
}

export interface ImportMappingStepProps {
  preview: CsvPreviewResponse;
  mapping: ColumnMapping;
  onMappingChange: (column: string, field: LeadField | "skip") => void;
  onImport: () => void;
  onCancel: () => void;
  leadFieldOptions: LeadFieldOption[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ImportProgressStepProps {}

export interface ImportCompletedStepProps {
  result: ImportResult;
  onReset: () => void;
}
