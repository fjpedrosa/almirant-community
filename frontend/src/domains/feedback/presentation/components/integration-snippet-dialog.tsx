import { useTranslations } from "next-intl";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { IntegrationSnippetDialogProps } from "../../domain/types";

const buildScriptTagSnippet = (publicKey: string): string =>
  `<!-- Add the feedback widget to your HTML -->
<script src="https://cdn.example.com/feedback-widget.iife.js"><\/script>
<script>
  FeedbackWidget.init({
    publicKey: '${publicKey}',
    position: 'bottom-right',
    theme: 'auto',
  });
<\/script>`;

const buildReactHookSnippet = (publicKey: string): string =>
  `import { useFeedbackWidget } from '@almirant/feedback-react';

function App() {
  const { open, isReady } = useFeedbackWidget({
    publicKey: '${publicKey}',
    position: 'bottom-right',
    theme: 'auto',
  });

  return (
    <button onClick={open} disabled={!isReady}>
      Send Feedback
    </button>
  );
}`;

const buildReactComponentSnippet = (publicKey: string): string =>
  `import { FeedbackWidget } from '@almirant/feedback-react';

function Layout({ children }) {
  return (
    <>
      {children}
      <FeedbackWidget
        publicKey="${publicKey}"
        position="bottom-right"
        theme="auto"
        onSubmitSuccess={(data) => console.log('Sent:', data.id)}
      />
    </>
  );
}`;

const SnippetCopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const t = useTranslations("feedbackSources.integration");

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="absolute top-2 right-2"
      onClick={handleCopy}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 mr-1 text-green-500" />
          <span className="text-green-500">{t("copied")}</span>
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5 mr-1" />
          {t("copy")}
        </>
      )}
    </Button>
  );
};

const CodeBlock: React.FC<{ code: string }> = ({ code }) => (
  <div className="relative">
    <SnippetCopyButton text={code} />
    <pre className="overflow-x-auto rounded-md bg-muted p-4 pr-24 text-sm leading-relaxed">
      <code>{code}</code>
    </pre>
  </div>
);

export const IntegrationSnippetDialog: React.FC<
  IntegrationSnippetDialogProps
> = ({ open, onOpenChange, source }) => {
  const t = useTranslations("feedbackSources.integration");

  if (!source) return null;

  const publicKey = source.publicKey;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description", { name: source.name })}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="script-tag" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="script-tag">{t("tabScriptTag")}</TabsTrigger>
            <TabsTrigger value="react-hook">{t("tabReactHook")}</TabsTrigger>
            <TabsTrigger value="react-component">
              {t("tabReactComponent")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="script-tag" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("scriptTagDescription")}
            </p>
            <CodeBlock code={buildScriptTagSnippet(publicKey)} />
          </TabsContent>

          <TabsContent value="react-hook" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("reactHookDescription")}
            </p>
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <code>bun add @almirant/feedback-react</code>
            </div>
            <CodeBlock code={buildReactHookSnippet(publicKey)} />
          </TabsContent>

          <TabsContent value="react-component" className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("reactComponentDescription")}
            </p>
            <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              <code>bun add @almirant/feedback-react</code>
            </div>
            <CodeBlock code={buildReactComponentSnippet(publicKey)} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
