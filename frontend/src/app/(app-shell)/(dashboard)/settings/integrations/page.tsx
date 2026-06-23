import { Suspense } from "react";
import { CardGridSkeleton } from "@/components/skeletons";
import { IntegrationsPageContainer } from "@/domains/integrations/presentation/containers/integrations-page-container";

export default function IntegrationsPage() {
  return (
    <Suspense fallback={<CardGridSkeleton />}>
      <IntegrationsPageContainer
        categories={["deployment", "monitoring", "communication"]}
        title="Other Integrations"
        description="Connect deployment, observability, analytics, and communication services that do not belong to code, AI, or agent provider scopes."
      />
    </Suspense>
  );
}
