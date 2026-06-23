import { BetaGate } from "@/domains/shared/presentation/components/beta-gate";
import { WebhooksPageContainer } from "@/domains/webhooks/presentation/containers/webhooks-page-container";

export default function WebhooksPage() {
  return (
    <BetaGate flagKey="settings-webhooks-beta">
      <WebhooksPageContainer />
    </BetaGate>
  );
}
