"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeleteBoardDialogProps } from "../../domain/types";

export const DeleteBoardDialog: React.FC<DeleteBoardDialogProps> = ({
  open,
  onOpenChange,
  board,
  onConfirm,
  isLoading,
}) => {
  const t = useTranslations("boards.delete");
  const tCommon = useTranslations("common");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>
                {t("warning")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {board && (
          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="text-sm">
              {t("confirmation")}{" "}
              <span className="font-semibold">{board.name}</span>?
            </p>
            {board.totalItems > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                {t("itemsWarning", { count: board.totalItems })}
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? t("deleting") : t("button")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
