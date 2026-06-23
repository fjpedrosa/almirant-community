"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Copy, AlertTriangle } from "lucide-react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import type { ApiKeyCreatedDialogProps } from "@/domains/api-keys/domain/types";

const handleCopy = (key: string) => {
  navigator.clipboard.writeText(key);
  showToast.success("Copied to clipboard");
};

export const ApiKeyCreatedDialog: React.FC<ApiKeyCreatedDialogProps> = ({
  open,
  onOpenChange,
  createdKey,
}) => {
  if (!createdKey) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>API Key Created</DialogTitle>
          <DialogDescription>
            Your new API key has been created for &ldquo;{createdKey.name}&rdquo;.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              This key will only be shown once. Store it in a safe place.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <code className="flex-1 text-sm bg-muted p-3 rounded-md break-all font-mono">
              {createdKey.key}
            </code>
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleCopy(createdKey.key)}
              aria-label="Copy to clipboard"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
