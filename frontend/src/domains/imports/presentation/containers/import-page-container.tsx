"use client";

import { useTranslations } from "next-intl";
import { useImportWizard } from "../../application/hooks/use-import-wizard";
import { ImportUploadStep } from "../components/import-upload-step";
import { ImportMappingStep } from "../components/import-mapping-step";
import { ImportProgressStep } from "../components/import-progress-step";
import { ImportCompletedStep } from "../components/import-completed-step";

export const ImportPageContainer: React.FC = () => {
  const {
    step,
    preview,
    mapping,
    importResult,
    getRootProps,
    getInputProps,
    isDragActive,
    handleMappingChange,
    handleImport,
    handleReset,
    leadFieldOptions,
  } = useImportWizard();
  const t = useTranslations("imports");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      {step === "upload" && (
        <ImportUploadStep
          getRootProps={getRootProps}
          getInputProps={getInputProps}
          isDragActive={isDragActive}
        />
      )}

      {step === "mapping" && preview && (
        <ImportMappingStep
          preview={preview}
          mapping={mapping}
          onMappingChange={handleMappingChange}
          onImport={handleImport}
          onCancel={handleReset}
          leadFieldOptions={leadFieldOptions}
        />
      )}

      {step === "importing" && <ImportProgressStep />}

      {step === "completed" && importResult && (
        <ImportCompletedStep
          result={importResult}
          onReset={handleReset}
        />
      )}
    </div>
  );
};
