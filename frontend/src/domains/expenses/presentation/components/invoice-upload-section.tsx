import { useRef } from "react";
import { Upload, FileText, Loader2, CheckCircle, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface InvoiceUploadSectionProps {
  isUploading: boolean;
  hasInvoice: boolean;
  invoiceFileName?: string | null;
  invoiceProcessingStatus?: string | null;
  onFileSelect: (file: File) => void;
}

const PROCESSING_STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: {
    label: "Pending",
    icon: <Clock className="h-3 w-3" />,
    variant: "secondary",
  },
  processing: {
    label: "Processing",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    variant: "default",
  },
  processed: {
    label: "Processed",
    icon: <CheckCircle className="h-3 w-3" />,
    variant: "default",
  },
  failed: {
    label: "Failed",
    icon: <XCircle className="h-3 w-3" />,
    variant: "destructive",
  },
};

export const InvoiceUploadSection: React.FC<InvoiceUploadSectionProps> = ({
  isUploading,
  hasInvoice,
  invoiceFileName,
  invoiceProcessingStatus,
  onFileSelect,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
      // Reset input so the same file can be re-selected if needed
      e.target.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const statusConfig =
    invoiceProcessingStatus && invoiceProcessingStatus in PROCESSING_STATUS_CONFIG
      ? PROCESSING_STATUS_CONFIG[invoiceProcessingStatus]
      : null;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Invoice</p>

      {hasInvoice && invoiceFileName ? (
        <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm truncate text-muted-foreground">{invoiceFileName}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            {statusConfig && (
              <Badge
                variant={statusConfig.variant}
                className="flex items-center gap-1 text-xs"
              >
                {statusConfig.icon}
                {statusConfig.label}
              </Badge>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isUploading}
              onClick={() => inputRef.current?.click()}
              className="h-7 text-xs"
            >
              Replace
            </Button>
          </div>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          className={cn(
            "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer",
            isUploading
              ? "border-primary/30 bg-primary/5 pointer-events-none"
              : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
          )}
          onClick={() => !isUploading && inputRef.current?.click()}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === " ") && !isUploading) {
              inputRef.current?.click();
            }
          }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
              <p className="text-sm text-muted-foreground">Uploading invoice...</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm font-medium">Upload invoice</p>
              <p className="text-xs text-muted-foreground mt-1">
                PDF, PNG, JPG up to 10MB
              </p>
              <p className="text-xs text-muted-foreground">
                Click or drag and drop
              </p>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
};
