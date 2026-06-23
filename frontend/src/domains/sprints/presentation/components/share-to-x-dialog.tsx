import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Copy, ExternalLink } from "lucide-react";
import type { ShareToXDialogProps } from "../../domain/types";

export const ShareToXDialog: React.FC<ShareToXDialogProps> = ({
  open,
  onOpenChange,
  draft,
  isPreparing,
  isCopying,
  onCopyThread,
  onOpenIntent,
  isShareAvailable,
}) => {
  const t = useTranslations("sprints.report.share");

  const tweets = draft?.tweets ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-hidden p-0">
        <div className="p-6 pb-4">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {t("description")}
            </DialogDescription>
          </DialogHeader>
        </div>

        <ScrollArea className="max-h-[58vh] px-6">
          {isPreparing ? (
            <p className="pb-6 text-sm text-muted-foreground">{t("loading")}</p>
          ) : isShareAvailable ? (
            <div className="space-y-3 pb-6">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{draft?.title}</p>
                <Badge variant="secondary" className="text-[10px]">
                  {t("tweets", { count: draft?.totalTweets ?? 0 })}
                </Badge>
              </div>

              {tweets.map((tweet) => (
                <div key={tweet.index} className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <p className="whitespace-pre-wrap text-sm">{tweet.text}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("characters", { count: tweet.characterCount })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="pb-6 text-sm text-muted-foreground">{t("empty")}</p>
          )}
        </ScrollArea>

        <div className="border-t px-6 py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCopyThread}
              disabled={!isShareAvailable || isCopying}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              {isCopying ? t("copying") : t("copy")}
            </Button>
            <Button
              type="button"
              onClick={onOpenIntent}
              disabled={!isShareAvailable}
            >
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              {t("openX")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
