import { Megaphone, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ShareProgressBannerProps {
  title: string;
  description: string;
  shareLabel: string;
  dismissLabel: string;
  closeLabel: string;
  onShare: () => void;
  onDismiss: () => void;
  onClose: () => void;
}

export const ShareProgressBanner: React.FC<ShareProgressBannerProps> = ({
  title,
  description,
  shareLabel,
  dismissLabel,
  closeLabel,
  onShare,
  onDismiss,
  onClose,
}) => {
  return (
    <Card className="border-muted/60 bg-gradient-to-r from-muted/30 to-background">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 h-9 w-9 rounded-lg bg-background border flex items-center justify-center shrink-0">
              <Megaphone className="h-4 w-4" aria-hidden={true} />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold leading-6 truncate">{title}</h2>
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={closeLabel}
            className="-mt-1 -mr-1"
          >
            <X className="h-4 w-4" aria-hidden={true} />
          </Button>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
            {dismissLabel}
          </Button>
          <Button type="button" size="sm" onClick={onShare}>
            {shareLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
