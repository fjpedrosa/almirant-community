import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";
import type { GenerateDocsDialogProps } from "../../domain/types";

export const GenerateDocsDialog: React.FC<GenerateDocsDialogProps> = ({
  open,
  onOpenChange,
  workItemTitle,
  onConfirm,
  onSkip,
  isGenerating,
}) => {
  const t = useTranslations("workItems.generateDocs");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={!isGenerating}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-500" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {t("description", { title: workItemTitle })}
          </DialogDescription>
        </DialogHeader>

        <div className="text-sm text-muted-foreground">
          <p>{t("explanation")}</p>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onSkip}
            disabled={isGenerating}
          >
            {t("skip")}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t("generating")}
              </>
            ) : (
              t("confirm")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
