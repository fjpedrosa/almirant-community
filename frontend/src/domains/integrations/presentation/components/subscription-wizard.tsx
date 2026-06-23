import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Copy, Loader2, Terminal } from "lucide-react";
import { showToast } from "@/domains/shared/presentation/utils/show-toast";
import type { SubscriptionWizardProps } from "../../domain/types";

const PROVIDER_INSTRUCTIONS = {
  anthropic: {
    title: "Connect Claude Max Subscription",
    steps: [
      "Click Next to open Anthropic authorization in a new tab.",
      "Authorize Almirant",
      "After authorization, wait until the browser lands on the Claude callback page.",
      "Copy the full callback URL from the browser address bar and paste it in the next step so Almirant can exchange it for usage-enabled OAuth credentials.",
    ],
    pasteLabel: "Callback URL",
    pastePlaceholder:
      "Paste the full https://platform.claude.com/oauth/code/callback?... URL",
    isJson: false,
  },
  openai: {
    title: "Connect ChatGPT Pro Subscription",
    steps: [
      "Click Next to open the OpenAI authorization page in a new tab.",
      "Approve the Codex access request for Almirant.",
      "Keep the authorization tab open while Almirant captures the redirect callback automatically.",
      "After approval, you will return here to name and save the connection.",
    ],
    pasteLabel: "Authorization status",
    pastePlaceholder: "",
    isJson: false,
  },
} as const;

export const SubscriptionWizard: React.FC<SubscriptionWizardProps> = ({
  provider,
  step,
  tokenValue,
  tokenError,
  isValidating,
  isValid,
  connectionName,
  isSaving,
  onTokenChange,
  onConnectionNameChange,
  onNext,
  onBack,
  onSave,
  onCancel,
  canUseCli,
  cliCommand,
  isPollingCli,
  cliError,
  onStartCli,
  deviceCode,
  deviceVerificationUrl,
  isPollingDevice,
  deviceError,
}) => {
  const info = provider === "anthropic" || provider === "openai"
    ? PROVIDER_INSTRUCTIONS[provider]
    : PROVIDER_INSTRUCTIONS.anthropic;

  const stepNumber = step === "instructions" ? 1 : step === "device-code" ? 2 : step === "paste" ? 2 : step === "cli" ? 2 : 3;

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Terminal className="h-4 w-4" />
          {info.title}
          <span className="text-muted-foreground ml-auto text-xs">Step {stepNumber} of 3</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {step === "instructions" && (
          <>
            <div className="space-y-2">
              {info.steps.map((text, i) => (
                <p key={i} className={i === 1 ? "bg-muted rounded-md px-3 py-2 font-mono text-sm" : "text-muted-foreground text-sm"}>
                  {text}
                </p>
              ))}
            </div>
            {tokenError && (
              <Alert variant="destructive" className="py-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{tokenError}</AlertDescription>
              </Alert>
            )}
            <div className="flex items-center justify-between gap-2 pt-2">
              {canUseCli ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onStartCli}
                  className="text-xs text-muted-foreground"
                >
                  <Terminal className="mr-1 h-3 w-3" /> Connect via CLI
                </Button>
              ) : (
                <div />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={onNext} disabled={isValidating}>
                  {isValidating ? (
                    <>
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Opening...
                    </>
                  ) : (
                    <>
                      Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}

        {step === "paste" && (
          <>
            {provider === "openai" ? (
              <>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>{info.pasteLabel}</Label>
                    <p className="text-muted-foreground text-sm">
                      Finish the OpenAI authorization in the popup/tab. This step advances automatically after the callback is captured.
                    </p>
                  </div>

                  {isValidating && (
                    <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for OpenAI authorization...
                    </p>
                  )}

                  {tokenError && !isValidating && (
                    <Alert variant="destructive" className="py-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{tokenError}</AlertDescription>
                    </Alert>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={onBack}>
                    <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>{info.pasteLabel}</Label>
                  <Input
                    type="password"
                    placeholder={info.pastePlaceholder}
                    value={tokenValue}
                    onChange={(e) => onTokenChange(e.target.value)}
                    autoComplete="off"
                  />

                  {isValidating && (
                    <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Validating...
                    </p>
                  )}
                  {isValid && !isValidating && (
                    <p className="flex items-center gap-1.5 text-sm text-green-600">
                      <Check className="h-3.5 w-3.5" /> Callback URL ready
                    </p>
                  )}
                  {tokenError && !isValidating && (
                    <Alert variant="destructive" className="py-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{tokenError}</AlertDescription>
                    </Alert>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" onClick={onBack}>
                    <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
                  </Button>
                  <Button type="button" size="sm" onClick={onNext} disabled={!isValid || isValidating}>
                    Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {step === "cli" && (
          <>
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Run this command in your terminal. The connection will be created automatically.
              </p>
              {cliCommand && (
                <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2">
                  <code className="flex-1 select-all font-mono text-xs">{cliCommand}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => {
                      void navigator.clipboard.writeText(cliCommand);
                      showToast.success("Command copied to clipboard");
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
              {isPollingCli && (
                <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for CLI to connect...
                </p>
              )}
              {cliError && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{cliError}</AlertDescription>
                </Alert>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={onBack}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
            </div>
          </>
        )}

        {step === "device-code" && (
          <>
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Open the link below and enter this code to authorize Almirant:
              </p>
              <div className="flex flex-col items-center gap-3 py-2">
                <code className="bg-muted rounded-lg px-6 py-3 font-mono text-2xl font-bold tracking-widest select-all">
                  {deviceCode}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (deviceCode) {
                      void navigator.clipboard.writeText(deviceCode);
                      showToast.success("Code copied to clipboard");
                    }
                  }}
                >
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy code
                </Button>
              </div>
              {deviceVerificationUrl && (
                <div className="text-center">
                  <a
                    href={deviceVerificationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary text-sm underline underline-offset-4"
                  >
                    Open OpenAI verification page
                  </a>
                </div>
              )}
              {isPollingDevice && (
                <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for authorization...
                </p>
              )}
              {deviceError && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{deviceError}</AlertDescription>
                </Alert>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={onBack}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
            </div>
          </>
        )}

        {step === "confirm" && (
          <>
            <div className="space-y-3">
              <p className="flex items-center gap-1.5 text-sm text-green-600">
                <Check className="h-3.5 w-3.5" /> {provider === "anthropic" ? "Callback URL captured successfully" : "OpenAI authorization captured successfully"}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="sub-conn-name">Connection Name</Label>
                <Input
                  id="sub-conn-name"
                  placeholder={`My ${provider === "anthropic" ? "Claude Max" : "ChatGPT Pro"} subscription`}
                  value={connectionName}
                  onChange={(e) => onConnectionNameChange(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={onBack} disabled={isSaving}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
              </Button>
              <Button type="button" size="sm" onClick={onSave} disabled={isSaving || !connectionName.trim()}>
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Saving...
                  </>
                ) : (
                  "Save Connection"
                )}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
