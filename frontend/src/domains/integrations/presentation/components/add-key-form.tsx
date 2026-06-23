"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import type { AddKeyFormProps, ProviderType, SubscriptionWizardProps } from "../../domain/types";

const PROVIDER_NAMES: Record<ProviderType, string> = {
  github: "GitHub",
  vercel: "Vercel",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google AI",
  zai: "z.ai",
  xai: "xAI",
  sentry: "Sentry",
  posthog: "PostHog",
  zipu: "z.ai",
  discord: "Discord",
  gitlab: "GitLab",
};

const MODEL_PLACEHOLDERS: Record<ProviderType, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.5",
  google: "gemini-2.5-pro",
  zai: "glm-5.1",
  xai: "grok-4.20-reasoning",
  github: "",
  vercel: "",
  sentry: "",
  posthog: "",
  zipu: "glm-5.1",
  discord: "",
  gitlab: "",
};

export const AddKeyForm: React.FC<AddKeyFormProps> = ({
  provider,
  form,
  onSubmit,
  onCancel,
  isSubmitting,
  isTesting,
  testError,
  availableModels,
  showSubscriptionOption,
  onSubscriptionClick,
}) => {
  const providerName = PROVIDER_NAMES[provider];
  const isAnthropic = provider === "anthropic";
  const isOpenAi = provider === "openai";
  const supportsSubscription = (isAnthropic || isOpenAi) && showSubscriptionOption;
  const authMethod = form.watch("authMethod");
  const isSetupToken = authMethod === "setup_token";
  const isSubscription = authMethod === "subscription";
  const modelPlaceholder = MODEL_PLACEHOLDERS[provider];

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Plus className="h-4 w-4" />
          Add {providerName} Key
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder={`e.g. Production ${providerName} Key`} autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                          ? "Use a setup token from your Anthropic workspace (starts with sk-ant-oat01-)"
                          : `Use a standard API key from ${isAnthropic ? "console.anthropic.com" : "platform.openai.com"}`}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{isAnthropic && isSetupToken ? "Setup Token" : "API Key"}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder={isAnthropic && isSetupToken ? "sk-ant-oat01-..." : "sk-..."}
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
            </div>

            {testError && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{testError}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isSubmitting || isTesting}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting || isTesting || !form.formState.isValid}>
                {isTesting ? (
                  <>
                    <Loader2 className="mr-2 size-3.5 animate-spin" />
                    Verifying...
                  </>
                ) : isSubmitting ? (
                  "Adding..."
                ) : (
                  "Add Key"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};
