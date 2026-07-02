import { Suspense } from "react";
import { CardGridSkeleton } from "@/components/skeletons";
import { IntegrationsPageContainer } from "@/domains/integrations/presentation/containers/integrations-page-container";

export default function AiProvidersSettingsPage() {
  return (
    <Suspense fallback={<CardGridSkeleton />}>
      <IntegrationsPageContainer
        categories={["ai"]}
        title="AI Providers"
        description="Manage model providers, API keys, account scope, and workspace AI key resolution policy."
        showWorkspaceSelector
      />
    </Suspense>
  );
}
