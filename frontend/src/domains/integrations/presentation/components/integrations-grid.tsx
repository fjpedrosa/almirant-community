import { Skeleton } from "@/components/ui/skeleton";
import { ProviderCardMinimal } from "./provider-card-minimal";
import { AddProviderPlaceholderCard } from "./add-provider-placeholder-card";
import type {
  ConnectionCategory,
  IntegrationProviderItem,
  IntegrationsCategorySectionProps,
  IntegrationsGridProps,
} from "../../domain/types";

// ---------------------------------------------------------------------------
// Category config
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<ConnectionCategory, string> = {
  code: "Code Providers",
  ai: "AI Providers",
  deployment: "Deployment",
  monitoring: "Observability",
  communication: "Communication",
};

/** Render order for categories */
const CATEGORY_ORDER: ConnectionCategory[] = ["code", "ai", "deployment", "monitoring", "communication"];

// ---------------------------------------------------------------------------
// Subtitle helper
// ---------------------------------------------------------------------------

const getProviderSubtitle = (item: IntegrationProviderItem): string | undefined => {
  if (!item.isConnected || item.connectionCount === 0) return undefined;

  const count = item.connectionCount;

  // AI and monitoring providers use API keys
  if (item.category === "ai" || item.category === "monitoring") {
    return count === 1 ? "1 API key" : `${count} API keys`;
  }

  // Code and deployment providers use OAuth accounts
  return count === 1 ? "1 account connected" : `${count} accounts connected`;
};

// ---------------------------------------------------------------------------
// Grouping helper
// ---------------------------------------------------------------------------

const groupByCategory = (
  providers: IntegrationProviderItem[],
): Map<ConnectionCategory, IntegrationProviderItem[]> => {
  const groups = new Map<ConnectionCategory, IntegrationProviderItem[]>();

  for (const item of providers) {
    const existing = groups.get(item.category);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.category, [item]);
    }
  }

  return groups;
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

const IntegrationsGridSkeleton: React.FC = () => (
  <div className="space-y-8">
    {[1, 2, 3].map((section) => (
      <div key={section} className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[1, 2].map((card) => (
            <Skeleton key={card} className="h-[52px] rounded-xl" />
          ))}
        </div>
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

const IntegrationsGridEmpty: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <p className="text-sm text-muted-foreground">
      No integrations available.
    </p>
  </div>
);

// ---------------------------------------------------------------------------
// IntegrationsCategorySection - Purely presentational
// ---------------------------------------------------------------------------

interface CategorySectionInternalProps extends IntegrationsCategorySectionProps {
  /** Optional trailing content rendered at the end of the cards grid */
  trailingContent?: React.ReactNode;
}

const IntegrationsCategorySection: React.FC<CategorySectionInternalProps> = ({
  label,
  providers,
  onCardClick,
  trailingContent,
}) => (
  <section className="space-y-3">
    <h3 className="text-sm font-medium text-muted-foreground tracking-wide">
      {label}
    </h3>

    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {providers.map((item) => (
        <ProviderCardMinimal
          key={item.provider}
          provider={item.provider}
          name={item.name}
          status={item.status}
          subtitle={getProviderSubtitle(item)}
          featureFlagged={item.featureFlagged}
          comingSoon={item.comingSoon}
          onClick={() => onCardClick(item)}
        />
      ))}
      {trailingContent}
    </div>
  </section>
);

// ---------------------------------------------------------------------------
// IntegrationsGrid - Purely presentational
// ---------------------------------------------------------------------------
// Groups integration providers by category and renders a section per group.
// Shows skeleton cards while loading and an empty state when there are none.
// For the AI category, only connected providers are shown plus a placeholder card.
// ---------------------------------------------------------------------------

export const IntegrationsGrid: React.FC<IntegrationsGridProps> = ({
  providers,
  isLoading,
  onCardClick,
  onAddProviderClick,
}) => {
  if (isLoading) {
    return <IntegrationsGridSkeleton />;
  }

  if (providers.length === 0) {
    return <IntegrationsGridEmpty />;
  }

  const grouped = groupByCategory(providers);

  // For AI category, filter to only connected providers
  const aiProviders = grouped.get("ai");
  const connectedAiProviders = aiProviders?.filter((p) => p.isConnected) ?? [];

  return (
    <div className="space-y-8">
      {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((category) => {
        // AI section: show only connected providers + placeholder
        if (category === "ai") {
          return (
            <IntegrationsCategorySection
              key={category}
              label={CATEGORY_LABELS[category]}
              providers={connectedAiProviders}
              onCardClick={onCardClick}
              trailingContent={
                onAddProviderClick ? (
                  <AddProviderPlaceholderCard
                    isEmpty={connectedAiProviders.length === 0}
                    onClick={onAddProviderClick}
                  />
                ) : null
              }
            />
          );
        }

        // Other categories: render as before
        return (
          <IntegrationsCategorySection
            key={category}
            label={CATEGORY_LABELS[category]}
            providers={grouped.get(category)!}
            onCardClick={onCardClick}
          />
        );
      })}
    </div>
  );
};
