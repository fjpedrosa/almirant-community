import { useTranslations } from "next-intl";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Database,
  Globe,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import type {
  InstanceSettingsViewProps,
  TailnetDatabaseAccessStatus,
} from "../../domain/types";
import { CapacitySettingsSection } from "./capacity-settings-section";
import { OperationsSettingsSection } from "./operations-settings-section";

const statusVariant = (status?: TailnetDatabaseAccessStatus) => {
  if (status === "connected") return "default";
  if (status === "provisioning") return "secondary";
  if (status === "error") return "destructive";
  return "outline";
};

export const InstanceSettingsView = ({
  publicUrl,
  tailscale,
  tailnetDatabase,
  capacity,
  operations,
  isLoading,
}: InstanceSettingsViewProps) => {
  const t = useTranslations("instanceSettings");

  if (isLoading) {
    return null;
  }

  const dbStatus = tailnetDatabase.status;
  const isProvisioning = dbStatus?.status === "provisioning";
  const isConnected = dbStatus?.enabled && dbStatus.status === "connected";
  const showConfigurationForm = !isConnected || tailnetDatabase.isEditing;
  const formDisabled =
    isProvisioning ||
    tailnetDatabase.isConnecting ||
    tailnetDatabase.isDisabling;
  const canConnect =
    showConfigurationForm &&
    !formDisabled &&
    Boolean(tailnetDatabase.hostname) &&
    Boolean(tailnetDatabase.tag) &&
    (tailnetDatabase.authMethod === "auth_key"
      ? Boolean(tailnetDatabase.authKey)
      : Boolean(tailnetDatabase.oauthClientId) &&
        Boolean(tailnetDatabase.oauthClientSecret));

  return (
    <div className="space-y-6">
      <CapacitySettingsSection {...capacity} />

      <Separator />

      <OperationsSettingsSection {...operations} />

      <Separator />

      {/* Public URL Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t("publicUrl.title")}
          </CardTitle>
          <CardDescription>{t("publicUrl.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {publicUrl.currentUrl ? (
            <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <div>
                <span className="text-muted-foreground">
                  {t("publicUrl.current")}: {" "}
                </span>
                <span className="font-mono font-medium">
                  {publicUrl.currentUrl}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{t("publicUrl.notSet")}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="public-url">{t("publicUrl.label")}</Label>
            <Input
              id="public-url"
              type="url"
              placeholder={t("publicUrl.placeholder")}
              value={publicUrl.inputUrl}
              onChange={(e) => publicUrl.onInputUrlChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("publicUrl.hint")}
            </p>
          </div>
          <Button
            onClick={publicUrl.onSave}
            disabled={
              publicUrl.isSaving ||
              !publicUrl.inputUrl.startsWith("https://")
            }
          >
            {publicUrl.isSaving
              ? t("publicUrl.saving")
              : t("publicUrl.save")}
          </Button>
        </CardContent>
      </Card>

      <Separator />

      {/* Tailscale Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t("tailscale.title")}
          </CardTitle>
          <CardDescription>{t("tailscale.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tailscale.available ? (
            <>
              {tailscale.hostname && (
                <div className="text-sm">
                  <span className="text-muted-foreground">
                    {t("tailscale.hostname")}: {" "}
                  </span>
                  <span className="font-mono">{tailscale.hostname}</span>
                </div>
              )}
              {tailscale.suggestedUrl && (
                <div className="text-sm">
                  <span className="text-muted-foreground">
                    {t("tailscale.suggestedUrl")}: {" "}
                  </span>
                  <span className="font-mono">{tailscale.suggestedUrl}</span>
                </div>
              )}

              {tailscale.servingHttps && (
                <div className="flex items-center gap-2 rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">{t("tailscale.serving")}</p>
                    {tailscale.httpsTarget && (
                      <p className="mt-0.5 font-mono text-xs">
                        {t("tailscale.servingTarget")}: {tailscale.httpsTarget}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {tailscale.serveResult?.publicUrl && (
                <div className="rounded-md bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300">
                  <p className="font-medium">
                    {t("tailscale.publishedSuccess")}
                  </p>
                  <p className="mt-1 font-mono">
                    {tailscale.serveResult.publicUrl}
                  </p>
                </div>
              )}

              {tailscale.serveResult?.copyPasteCommand && (
                <div className="space-y-1">
                  <Label>{t("tailscale.copyCommand")}</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono">
                      {tailscale.serveResult.copyPasteCommand}
                    </code>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      aria-label={t("tailscale.copy")}
                      onClick={() =>
                        navigator.clipboard.writeText(
                          tailscale.serveResult!.copyPasteCommand,
                        )
                      }
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                {!tailscale.servingHttps && (
                  <Button
                    onClick={tailscale.onServe}
                    disabled={tailscale.isServing}
                  >
                    {tailscale.isServing
                      ? t("tailscale.publishing")
                      : t("tailscale.publish")}
                  </Button>
                )}
                {tailscale.servingHttps && (
                  <Button
                    variant="destructive"
                    onClick={tailscale.onDisable}
                    disabled={tailscale.isDisabling}
                  >
                    {tailscale.isDisabling
                      ? t("tailscale.disabling")
                      : t("tailscale.disable")}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {tailscale.reason ?? t("tailscale.notAvailable")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                {t("privateDatabase.title")}
              </CardTitle>
              <CardDescription>{t("privateDatabase.description")}</CardDescription>
            </div>
            <Badge
              variant={statusVariant(dbStatus?.status)}
              className="w-fit gap-1"
            >
              {isProvisioning && <Loader2 className="h-3 w-3 animate-spin" />}
              {t(`privateDatabase.status.${dbStatus?.status ?? "not_configured"}`)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start gap-2 rounded-md bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{t("privateDatabase.securityNote")}</p>
          </div>

          {isProvisioning && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              <div>
                <p className="font-medium">
                  {t("privateDatabase.provisioningTitle")}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  {t("privateDatabase.provisioningDescription")}
                </p>
              </div>
            </div>
          )}

          {dbStatus?.lastError && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{dbStatus.lastError}</p>
            </div>
          )}

          {dbStatus?.connectionString && (
            <div className="space-y-2">
              <Label>{t("privateDatabase.connectionString")}</Label>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs font-mono">
                  {dbStatus.connectionString}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("privateDatabase.copyConnectionString")}
                  onClick={() =>
                    navigator.clipboard.writeText(dbStatus.connectionString!)
                  }
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {dbStatus?.magicDnsName && (
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">
                  {t("privateDatabase.magicDns")}: {" "}
                </span>
                <span className="font-mono">{dbStatus.magicDnsName}</span>
              </div>
              {dbStatus.tailscaleIp && (
                <div>
                  <span className="text-muted-foreground">
                    {t("privateDatabase.tailscaleIp")}: {" "}
                  </span>
                  <span className="font-mono">{dbStatus.tailscaleIp}</span>
                </div>
              )}
            </div>
          )}

          {isConnected && !showConfigurationForm && (
            <div className="rounded-md border bg-muted/30 p-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-3 text-sm">
                  <p className="font-medium">
                    {t("privateDatabase.connectedSummary")}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <span className="text-muted-foreground">
                        {t("privateDatabase.hostname")}: {" "}
                      </span>
                      <span className="font-mono">
                        {dbStatus?.hostname ?? tailnetDatabase.hostname}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t("privateDatabase.tag")}: {" "}
                      </span>
                      <span className="font-mono">
                        {dbStatus?.tag ?? tailnetDatabase.tag}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {t("privateDatabase.authMethod")}: {" "}
                      </span>
                      <span>
                        {dbStatus?.authMethod === "oauth_client"
                          ? t("privateDatabase.oauthClient")
                          : t("privateDatabase.authKey")}
                      </span>
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={tailnetDatabase.onEdit}
                  disabled={formDisabled}
                >
                  {t("privateDatabase.edit")}
                </Button>
              </div>
            </div>
          )}

          {showConfigurationForm && (
            <div className="space-y-5">
              {isConnected && tailnetDatabase.isEditing && (
                <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  {t("privateDatabase.editHelp")}
                </p>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tailnet-db-hostname">
                    {t("privateDatabase.hostname")}
                  </Label>
                  <Input
                    id="tailnet-db-hostname"
                    value={tailnetDatabase.hostname}
                    disabled={formDisabled}
                    onChange={(event) =>
                      tailnetDatabase.onHostnameChange(event.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tailnet-db-tag">
                    {t("privateDatabase.tag")}
                  </Label>
                  <Input
                    id="tailnet-db-tag"
                    value={tailnetDatabase.tag}
                    disabled={formDisabled}
                    onChange={(event) =>
                      tailnetDatabase.onTagChange(event.target.value)
                    }
                  />
                </div>
              </div>

              <RadioGroup
                value={tailnetDatabase.authMethod}
                disabled={formDisabled}
                onValueChange={(value) =>
                  tailnetDatabase.onAuthMethodChange(
                    value as typeof tailnetDatabase.authMethod,
                  )
                }
                className="grid gap-3 sm:grid-cols-2"
              >
                <Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                  <RadioGroupItem value="auth_key" className="mt-1" />
                  <span>
                    <span className="block font-medium">
                      {t("privateDatabase.authKey")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("privateDatabase.authKeyHint")}
                    </span>
                  </span>
                </Label>
                <Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                  <RadioGroupItem value="oauth_client" className="mt-1" />
                  <span>
                    <span className="block font-medium">
                      {t("privateDatabase.oauthClient")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("privateDatabase.oauthClientHint")}
                    </span>
                  </span>
                </Label>
              </RadioGroup>

              {tailnetDatabase.authMethod === "auth_key" ? (
                <div className="space-y-2">
                  <Label htmlFor="tailnet-db-auth-key">
                    {t("privateDatabase.authKeyLabel")}
                  </Label>
                  <Input
                    id="tailnet-db-auth-key"
                    type="password"
                    value={tailnetDatabase.authKey}
                    disabled={formDisabled}
                    placeholder="tskey-auth-..."
                    onChange={(event) =>
                      tailnetDatabase.onAuthKeyChange(event.target.value)
                    }
                  />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="tailnet-db-oauth-id">
                      {t("privateDatabase.oauthClientId")}
                    </Label>
                    <Input
                      id="tailnet-db-oauth-id"
                      value={tailnetDatabase.oauthClientId}
                      disabled={formDisabled}
                      onChange={(event) =>
                        tailnetDatabase.onOauthClientIdChange(event.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tailnet-db-oauth-secret">
                      {t("privateDatabase.oauthClientSecret")}
                    </Label>
                    <Input
                      id="tailnet-db-oauth-secret"
                      type="password"
                      value={tailnetDatabase.oauthClientSecret}
                      disabled={formDisabled}
                      placeholder="tskey-client-..."
                      onChange={(event) =>
                        tailnetDatabase.onOauthClientSecretChange(
                          event.target.value,
                        )
                      }
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={tailnetDatabase.onConnect} disabled={!canConnect}>
                  {tailnetDatabase.isConnecting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {isConnected
                    ? t("privateDatabase.saveChanges")
                    : t("privateDatabase.connect")}
                </Button>
                {isConnected && tailnetDatabase.isEditing && (
                  <Button
                    variant="ghost"
                    onClick={tailnetDatabase.onCancelEdit}
                    disabled={formDisabled}
                  >
                    {t("privateDatabase.cancelEdit")}
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={tailnetDatabase.onTest}
              disabled={
                tailnetDatabase.isTesting ||
                isProvisioning ||
                !dbStatus?.enabled
              }
            >
              {tailnetDatabase.isTesting
                ? t("privateDatabase.testing")
                : t("privateDatabase.test")}
            </Button>
            <Button
              variant="destructive"
              onClick={tailnetDatabase.onDisable}
              disabled={
                tailnetDatabase.isDisabling ||
                isProvisioning ||
                !dbStatus?.enabled
              }
            >
              {tailnetDatabase.isDisabling
                ? t("privateDatabase.disabling")
                : t("privateDatabase.disable")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
