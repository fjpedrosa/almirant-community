import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Copy, AlertTriangle, Check } from "lucide-react";
import type { RotateKeyDialogProps } from "@/domains/api-keys/domain/types";

interface RotateKeyDialogPropsExtended extends RotateKeyDialogProps {
  onCopy: () => void;
  copied: boolean;
}

export const RotateKeyDialog: React.FC<RotateKeyDialogPropsExtended> = ({
  open,
  onOpenChange,
  newKey,
  onCopy,
  copied,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Service Account Key</DialogTitle>
          <DialogDescription>
            The key has been generated successfully. Copy it now - you will not
            be able to see it again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This key will only be shown once. Make sure to copy and store it
              securely. If you lose it, you will need to generate a new one.
            </AlertDescription>
          </Alert>

          <div className="flex gap-2">
            <Input
              value={newKey || ""}
              readOnly
              className="font-mono text-sm"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={onCopy}
              aria-label="Copy key"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
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
