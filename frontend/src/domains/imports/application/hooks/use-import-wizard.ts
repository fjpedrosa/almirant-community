"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { importsApi } from "@/lib/api/client";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import Papa from "papaparse";
import type {
  CsvPreviewResponse,
  ColumnMapping,
  LeadField,
  ImportStep,
  ImportResult,
  LeadFieldOption,
} from "../../domain/types";

export const leadFieldOptions: LeadFieldOption[] = [
  { value: "skip", label: "-- Ignorar --" },
  { value: "name", label: "Nombre" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Teléfono" },
  { value: "company", label: "Empresa" },
  { value: "position", label: "Cargo" },
  { value: "source", label: "Fuente" },
  { value: "profileUrl", label: "URL del Perfil" },
  { value: "notes", label: "Notas" },
];

export const useImportWizard = () => {
  const [step, setStep] = useState<ImportStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreviewResponse | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [parsedData, setParsedData] = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const csvFile = acceptedFiles[0];
    if (!csvFile) return;

    setFile(csvFile);

    // Parse CSV
    const text = await csvFile.text();
    const result = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
    });

    if (result.errors.length > 0) {
      showToast.error(`Error al parsear CSV: ${result.errors[0].message}`);
      return;
    }

    if (!result.meta.fields || result.meta.fields.length === 0) {
      showToast.error("El CSV no tiene encabezados");
      return;
    }

    // Generate preview and suggested mapping
    const headers = result.meta.fields;
    const suggestedMapping: ColumnMapping = {};

    headers.forEach((header) => {
      const lowerHeader = header.toLowerCase();
      if (lowerHeader.includes("name") || lowerHeader.includes("nombre")) {
        suggestedMapping[header] = "name";
      } else if (lowerHeader.includes("email") || lowerHeader.includes("correo")) {
        suggestedMapping[header] = "email";
      } else if (
        lowerHeader.includes("phone") ||
        lowerHeader.includes("tel") ||
        lowerHeader.includes("telefono")
      ) {
        suggestedMapping[header] = "phone";
      } else if (
        lowerHeader.includes("company") ||
        lowerHeader.includes("empresa")
      ) {
        suggestedMapping[header] = "company";
      } else if (
        lowerHeader.includes("position") ||
        lowerHeader.includes("cargo") ||
        lowerHeader.includes("title")
      ) {
        suggestedMapping[header] = "position";
      } else if (lowerHeader.includes("source") || lowerHeader.includes("origen")) {
        suggestedMapping[header] = "source";
      } else if (
        lowerHeader.includes("profile") ||
        lowerHeader.includes("linkedin") ||
        lowerHeader.includes("url")
      ) {
        suggestedMapping[header] = "profileUrl";
      } else if (lowerHeader.includes("note") || lowerHeader.includes("nota")) {
        suggestedMapping[header] = "notes";
      } else {
        suggestedMapping[header] = null;
      }
    });

    setPreview({
      headers,
      sampleRows: result.data.slice(0, 5),
      totalRows: result.data.length,
      suggestedMapping,
    });
    setMapping(suggestedMapping);
    setParsedData(result.data);
    setStep("mapping");
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
    },
    maxFiles: 1,
  });

  const handleMappingChange = useCallback(
    (column: string, field: LeadField | "skip") => {
      setMapping((prev) => ({
        ...prev,
        [column]: field === "skip" ? null : field,
      }));
    },
    []
  );

  const handleImport = useCallback(async () => {
    // Validate name mapping
    const hasNameMapping = Object.values(mapping).includes("name");
    if (!hasNameMapping) {
      showToast.error("Debes mapear al menos el campo Nombre");
      return;
    }

    setStep("importing");
    setImporting(true);

    try {
      const result = await importsApi.start({
        fileName: file?.name || "import.csv",
        columnMapping: mapping,
        data: parsedData,
      });

      const importJob = result as {
        successCount: number;
        errorCount: number;
        totalRows: number;
      };

      setImportResult({
        success: importJob.successCount,
        errors: importJob.errorCount,
        total: importJob.totalRows,
      });
      setStep("completed");
      showToast.success("Importación completada");
    } catch {
      showToast.error("Error durante la importación");
      setStep("mapping");
    } finally {
      setImporting(false);
    }
  }, [mapping, file, parsedData]);

  const handleReset = useCallback(() => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setMapping({});
    setParsedData([]);
    setImportResult(null);
  }, []);

  return {
    step,
    file,
    preview,
    mapping,
    parsedData,
    importing,
    importResult,
    getRootProps,
    getInputProps,
    isDragActive,
    handleMappingChange,
    handleImport,
    handleReset,
    leadFieldOptions,
  };
};
