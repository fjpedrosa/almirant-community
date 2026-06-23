import { Suspense } from "react";
import { CardGridSkeleton } from "@/components/skeletons";
import { CodeProvidersSettingsContainer } from "@/domains/settings/presentation/containers/provider-settings/code-providers-settings-container";

export default function CodeProvidersSettingsPage() {
  return (
    <Suspense fallback={<CardGridSkeleton />}>
      <CodeProvidersSettingsContainer />
    </Suspense>
  );
}
