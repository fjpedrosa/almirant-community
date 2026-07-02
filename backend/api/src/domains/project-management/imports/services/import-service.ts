import {
  createImportJob,
  updateImportJob,
} from "@almirant/database";
import type { ImportStatus } from "@almirant/shared";

// ---- Domain types (import-specific, not in @almirant/shared) ----

interface ImportError {
  row: number;
  error: string;
}

type ImportField =
  | "name"
  | "email"
  | "phone"
  | "company"
  | "position"
  | "source"
  | "profileUrl"
  | "notes"
  | `customFields.${string}`;

interface ColumnMapping {
  [csvColumn: string]: ImportField | null;
}

interface CsvPreviewResponse {
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
  suggestedMapping: ColumnMapping;
}

interface ImportJob {
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

interface CreateImportRowRequest {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;
  source?: string;
  profileUrl?: string;
  avatarUrl?: string;
  notes?: string;
  customFields?: Record<string, unknown>;
  tagIds?: string[];
}

// ---- Business logic ----

// Suggest column mapping based on header names
const suggestMapping = (headers: string[]): ColumnMapping => {
  const mapping: ColumnMapping = {};

  const patterns: Record<ImportField, RegExp[]> = {
    name: [/^name$/i, /^full\s*name$/i, /^nombre$/i],
    email: [/^email$/i, /^e-mail$/i, /^correo$/i],
    phone: [/^phone$/i, /^tel$/i, /^telephone$/i, /^mobile$/i, /^telefono$/i],
    company: [/^company$/i, /^empresa$/i, /^workspace$/i],
    position: [/^position$/i, /^title$/i, /^job\s*title$/i, /^cargo$/i, /^puesto$/i],
    source: [/^source$/i, /^origen$/i, /^from$/i],
    profileUrl: [/^profile$/i, /^url$/i, /^linkedin$/i, /^link$/i],
    notes: [/^notes$/i, /^notas$/i, /^comments$/i],
  };

  headers.forEach((header) => {
    for (const [field, regexes] of Object.entries(patterns)) {
      if (regexes.some((regex) => regex.test(header))) {
        mapping[header] = field as ImportField;
        break;
      }
    }

    // If no match, map to custom field
    if (!(header in mapping)) {
      mapping[header] = null;
    }
  });

  return mapping;
};

// Preview CSV data
export const previewCsv = (
  headers: string[],
  rows: Record<string, string>[]
): CsvPreviewResponse => {
  return {
    headers,
    sampleRows: rows.slice(0, 5),
    totalRows: rows.length,
    suggestedMapping: suggestMapping(headers),
  };
};

// Process import
export const processImport = async (
  workspaceId: string,
  fileName: string,
  columnMapping: ColumnMapping,
  data: Record<string, string>[],
  tagIds?: string[]
): Promise<ImportJob> => {
  // Convert columnMapping to Record<string, string> (filter out null values)
  const dbColumnMapping: Record<string, string> = {};
  for (const [key, value] of Object.entries(columnMapping)) {
    if (value !== null) {
      dbColumnMapping[key] = value;
    }
  }

  // Create import job
  const job = await createImportJob(workspaceId, {
    fileName,
    status: "processing",
    totalRows: data.length,
    processedRows: 0,
    successCount: 0,
    errorCount: 0,
    errors: [],
    columnMapping: dbColumnMapping,
  });

  const errors: ImportError[] = [];
  let successCount = 0;
  let processedRows = 0;

  // Process each row
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    processedRows++;

    try {
      // Build row data from mapping
      const rowData: Partial<CreateImportRowRequest> = {
        source: "import",
        customFields: {},
      };

      for (const [csvColumn, field] of Object.entries(columnMapping)) {
        if (!field || !row![csvColumn]) continue;

        const value = row![csvColumn].trim();
        if (!value) continue;

        if (field.startsWith("customFields.")) {
          const customFieldName = field.replace("customFields.", "");
          rowData.customFields![customFieldName] = value;
        } else {
          (rowData as Record<string, unknown>)[field] = value;
        }
      }

      // Validate required field (name)
      if (!rowData.name) {
        errors.push({ row: i + 1, error: "Name is required" });
        continue;
      }

      // TODO: Import processing is not yet implemented for the new data model.
      // The original CRM lead import was removed. Wire up the appropriate
      // entity creation logic here when needed.
      throw new Error("Import processing not yet implemented");

      successCount++;
    } catch (error) {
      errors.push({
        row: i + 1,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }

    // Update progress every 10 rows
    if (processedRows % 10 === 0 || processedRows === data.length) {
      await updateImportJob(workspaceId, job.id, {
        processedRows,
        successCount,
        errorCount: errors.length,
        errors,
      });
    }
  }

  // Final update
  const finalJob = await updateImportJob(workspaceId, job.id, {
    status: errors.length === data.length ? "failed" : "completed",
    processedRows,
    successCount,
    errorCount: errors.length,
    errors,
    completedAt: new Date(),
  });

  return finalJob as unknown as ImportJob;
};
