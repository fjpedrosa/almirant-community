"use client";

import { useTranslations } from "next-intl";
import type { ConfirmDialogProps } from "@/domains/shared/domain/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Usage:
// const { isOpen, options, confirm, handleConfirm, handleCancel } = useConfirmDialog();
//
// const handleDelete = async () => {
//   const confirmed = await confirm({
//     title: 'Eliminar elemento',
//     description: 'Esta accion no se puede deshacer.',
//     variant: 'destructive',
//   });
//   if (confirmed) { /* perform deletion */ }
// };
//
// <ConfirmDialog isOpen={isOpen} options={options} onConfirm={handleConfirm} onCancel={handleCancel} />

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  options,
  onConfirm,
  onCancel,
}) => {
  const t = useTranslations("common");

  if (!options) return null;

  const isDestructive = options.variant === "destructive";

  return (
    <AlertDialog open={isOpen} onOpenChange={(open: boolean) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options.title}</AlertDialogTitle>
          {options.description && (
            <AlertDialogDescription>
              {options.description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {options.cancelLabel ?? t("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            variant={isDestructive ? "destructive" : "default"}
          >
            {options.confirmLabel ?? t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
