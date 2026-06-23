import { Loader2 } from "lucide-react";

/**
 * OpenAI OAuth callback landing page.
 *
 * This page is opened inside a popup by the subscription-connect flow.
 * The parent window polls `popup.location.href` for the `code` and `state`
 * query parameters, then closes the popup automatically.
 *
 * The page itself just shows a spinner — all logic lives in the parent.
 */
export default function OpenAiCallbackPage() {
  return (
    <div className="flex h-screen items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="text-sm">Connecting to OpenAI...</span>
    </div>
  );
}
