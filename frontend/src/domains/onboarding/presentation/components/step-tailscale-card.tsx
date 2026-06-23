import { useTranslations } from "next-intl";
import { CheckCircle2, Globe, Copy } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { StepTailscaleCardProps } from "../../domain/types";

export const StepTailscaleCard = ({
  activeTab,
  onTabChange,
  available,
  hostname,
  suggestedUrl,
  reason,
  publicUrl,
  isServing,
  onServe,
  serveResult,
  manualUrl,
  onManualUrlChange,
  isSavingUrl,
  onSaveManualUrl,
  detectedPublicUrl,
  onUseDetectedPublicUrl,
  isSkipping,
  onSkip,
  done,
}: StepTailscaleCardProps) => {
  const t = useTranslations("onboarding.tailscale");

  if (done && publicUrl) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            {t("titleDone")}
          </CardTitle>
          <CardDescription>{publicUrl}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={activeTab} onValueChange={onTabChange}>
          <TabsList>
            <TabsTrigger value="tailscale">{t("tabTailscale")}</TabsTrigger>
            <TabsTrigger value="custom">{t("tabCustom")}</TabsTrigger>
          </TabsList>

          <TabsContent value="tailscale" className="mt-4 space-y-4">
            {available ? (
              <>
                {hostname && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">
                      {t("hostname")}:{" "}
                    </span>
                    <span className="font-mono">{hostname}</span>
                  </div>
                )}
                {suggestedUrl && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">
                      {t("suggestedUrl")}:{" "}
                    </span>
                    <span className="font-mono">{suggestedUrl}</span>
                  </div>
                )}
                <Button onClick={onServe} disabled={isServing}>
                  {isServing ? t("publishing") : t("publish")}
                </Button>
                {serveResult?.publicUrl && (
                  <div className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300">
                    <p className="font-medium">{t("publishedSuccess")}</p>
                    <p className="mt-1 font-mono">{serveResult.publicUrl}</p>
                  </div>
                )}
                {serveResult?.copyPasteCommand && (
                  <div className="space-y-1">
                    <Label>{t("copyCommand")}</Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono">
                        {serveResult.copyPasteCommand}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            serveResult.copyPasteCommand,
                          )
                        }
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {reason ?? t("notAvailable")}
                </p>

                {detectedPublicUrl ? (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm">
                    <p className="text-muted-foreground">
                      {t("detectedUrlHint")}
                    </p>
                    <p className="mt-2 break-all font-mono text-foreground">
                      {detectedPublicUrl}
                    </p>
                    <Button
                      className="mt-3"
                      onClick={onUseDetectedPublicUrl}
                      disabled={isSavingUrl}
                    >
                      {isSavingUrl ? t("saving") : t("useDetectedUrl")}
                    </Button>
                  </div>
                ) : null}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onTabChange("custom")}
                >
                  {t("enterCustomUrl")}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="custom" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="manual-url">{t("customUrlLabel")}</Label>
              <Input
                id="manual-url"
                type="url"
                placeholder="https://your-domain.com"
                value={manualUrl}
                onChange={(e) => onManualUrlChange(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t("customUrlHint")}
              </p>
            </div>
            <Button
              onClick={onSaveManualUrl}
              disabled={isSavingUrl || !manualUrl.startsWith("https://")}
            >
              {isSavingUrl ? t("saving") : t("saveUrl")}
            </Button>
          </TabsContent>
        </Tabs>

        <div className="border-t pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onSkip}
            disabled={isSkipping}
          >
            {t("skip")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
