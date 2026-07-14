"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { AlertCircle, Loader2 } from "lucide-react";
import { getReasoningEffortOptions } from "@/lib/ai-model-reasoning";
import type { ApiKeyConnectDialogProps } from "../../domain/types";

// ---------------------------------------------------------------------------
// Provider display names
// ---------------------------------------------------------------------------

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google AI",
  zai: "z.ai",
  xai: "xAI",
};

const MODEL_PLACEHOLDERS: Record<string, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-5.6-sol",
  google: "gemini-3.5-flash",
  zai: "glm-5.2",
  xai: "grok-4.3",
};

// ---------------------------------------------------------------------------
// ApiKeyConnectDialog - Purely presentational
// Form dialog for creating a new API key connection. Renders name, provider
// select, API key (password), and an optional base URL field that appears
// only when the provider is "zai".
//
// Before creating, credentials are verified. The dialog shows a "Verifying..."
// state during testing and displays an inline error Alert if the test fails.
// ---------------------------------------------------------------------------

export const ApiKeyConnectDialog: React.FC<ApiKeyConnectDialogProps> = ({
  open,
  onOpenChange,
  form,
  onSubmit,
  isSubmitting,
  isFormValid,
  selectedProvider,
  isTesting,
  testError,
  isEditing,
  providerLocked,
  availableModels,
  showSubscriptionOption,
  onSubscriptionClick,
}) => {
  const providerName = PROVIDER_NAMES[selectedProvider] ?? selectedProvider;
  const isAnthropic = selectedProvider === "anthropic";
  const isOpenAi = selectedProvider === "openai";
  const isAiProvider = ["anthropic", "openai", "google", "zai", "xai"].includes(selectedProvider);
  const authMethod = form.watch("authMethod");
  const isSetupToken = authMethod === "setup_token";
  const isSubscription = authMethod === "subscription";
  const supportsSubscription = (isAnthropic || isOpenAi) && showSubscriptionOption;
  const modelPlaceholder = MODEL_PLACEHOLDERS[selectedProvider] ?? "gpt-5.6-sol";
  const reasoningContext = {
    codingAgent:
      selectedProvider === "anthropic"
        ? "claude-code"
        : selectedProvider === "openai"
          ? "codex"
          : "opencode",
    aiProvider: selectedProvider,
  } as const;
  const reasoningFields = [
    {
      name: "planningReasoningBudget" as const,
      label: "Planning Reasoning Effort",
      model: form.watch("planningModel"),
    },
    {
      name: "implementationReasoningBudget" as const,
      label: "Implementation Reasoning Effort",
      model: form.watch("implementationModel"),
    },
    {
      name: "validationReasoningBudget" as const,
      label: "Validation Reasoning Effort",
      model: form.watch("validationModel"),
    },
  ].map((field) => ({
    ...field,
    options: getReasoningEffortOptions({ ...reasoningContext, model: field.model }),
  }));
  const supportsReasoningEffort = reasoningFields.some((field) => field.options.length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? `Manage ${providerName}`
              : providerLocked
              ? `Connect ${providerName}`
              : "Add API Key Connection"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? `Update ${providerName} connection settings for this workspace.`
              : providerLocked
              ? `Provide your ${providerName} credentials to connect to your workspace.`
              : "Provide an API key to connect an external service to your workspace."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Name */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={`e.g. Production ${providerName} Key`}
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Provider - only shown when not locked */}
            {!providerLocked && (
              <FormField
                control={form.control}
                name="provider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Provider</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="anthropic">Anthropic</SelectItem>
                        <SelectItem value="openai">OpenAI</SelectItem>
                        <SelectItem value="google">Google AI</SelectItem>
                        <SelectItem value="zai">
                          z.ai
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Auth method - for Anthropic + providers with subscription support */}
            {(isAnthropic || supportsSubscription) && (
              <FormField
                control={form.control}
                name="authMethod"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Authentication method</FormLabel>
                    <FormControl>
                      <RadioGroup
                        value={field.value ?? "api_key"}
                        onValueChange={(value) => {
                          if (value === "subscription" && onSubscriptionClick) {
                            onSubscriptionClick();
                            return;
                          }
                          field.onChange(value);
                        }}
                        className="flex flex-wrap gap-4"
                      >
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="api_key" id="auth-api-key" />
                          <Label htmlFor="auth-api-key" className="cursor-pointer font-normal">
                            API Key
                          </Label>
                        </div>
                        {isAnthropic && (
                          <div className="flex items-center gap-2">
                            <RadioGroupItem value="setup_token" id="auth-setup-token" />
                            <Label htmlFor="auth-setup-token" className="cursor-pointer font-normal">
                              Setup Token
                            </Label>
                          </div>
                        )}
                        {supportsSubscription && (
                          <div className="flex items-center gap-2">
                            <RadioGroupItem value="subscription" id="auth-subscription" />
                            <Label htmlFor="auth-subscription" className="cursor-pointer font-normal">
                              Subscription
                            </Label>
                          </div>
                        )}
                      </RadioGroup>
                    </FormControl>
                    <FormDescription>
                      {isSubscription
                        ? `Connect your ${isAnthropic ? "Claude Max" : "ChatGPT Pro"} subscription`
                        : isSetupToken
                          ? 'Run "claude setup-token" in your terminal to generate a setup token (starts with sk-ant-oat01-)'
                          : `Use a standard API key from ${isAnthropic ? "console.anthropic.com" : "platform.openai.com"}`}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {selectedProvider === "zai" && (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                z.ai Coding Plan uses the official endpoint automatically. No
                base URL is required.
              </p>
            )}

            {!isEditing && !isSubscription && (
              <FormField
                control={form.control}
                name="apiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {isAnthropic && isSetupToken ? "Setup Token" : "API Key"}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={
                          isAnthropic && isSetupToken
                            ? "sk-ant-oat01-..."
                            : "sk-..."
                        }
                        autoComplete="off"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {isAiProvider && (
              <div className="space-y-3">
                <FormField
                  control={form.control}
                  name="planningModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Planning Model (optional)</FormLabel>
                      <Select
                        onValueChange={(value) =>
                          field.onChange(value === "__default__" ? "" : value)
                        }
                        value={field.value || "__default__"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={`Select model or leave empty (default: ${modelPlaceholder})`} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__default__">Default ({modelPlaceholder})</SelectItem>
                          {availableModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Model used for planning/ideation tasks.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="implementationModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Implementation Model (optional)</FormLabel>
                      <Select
                        onValueChange={(value) =>
                          field.onChange(value === "__default__" ? "" : value)
                        }
                        value={field.value || "__default__"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={`Select model or leave empty (default: ${modelPlaceholder})`} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__default__">Default ({modelPlaceholder})</SelectItem>
                          {availableModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Model used for implement/review/test tasks.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="validationModel"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Validation Model (optional)</FormLabel>
                      <Select
                        onValueChange={(value) =>
                          field.onChange(value === "__default__" ? "" : value)
                        }
                        value={field.value || "__default__"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={`Select model or leave empty (default: ${modelPlaceholder})`} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__default__">Default ({modelPlaceholder})</SelectItem>
                          {availableModels.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>Model used for validation/nightly-check tasks.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Reasoning Effort */}
                {supportsReasoningEffort && (
                  <div className="space-y-2 pt-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Reasoning Effort (optional)
                    </p>
                    {reasoningFields.map(({ name, label, options: reasoningOptions }) => (
                      <FormField
                        key={name}
                        control={form.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-normal">{label}</FormLabel>
                            <Select
                              onValueChange={(value) =>
                                field.onChange(value === "__default__" ? "" : value)
                              }
                              value={field.value || "__default__"}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Default" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__default__">Default</SelectItem>
                                {reasoningOptions.map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Controls how much reasoning is applied per task type.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Test error */}
            {testError && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{testError}</AlertDescription>
              </Alert>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || isTesting || !isFormValid}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Verifying...
                  </>
                ) : isSubmitting ? (
                  isEditing ? "Updating..." : "Saving..."
                ) : (
                  isEditing ? "Save Changes" : "Save Connection"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
