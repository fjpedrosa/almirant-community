import { Card } from "@/components/ui/card";
import { CardContent } from "@/components/ui/card";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AddProviderPlaceholderCardProps } from "../../domain/types";

// ---------------------------------------------------------------------------
// AddProviderPlaceholderCard - Placeholder card to add a new AI provider
// ---------------------------------------------------------------------------
// Two variants controlled by `isEmpty` prop:
// - isEmpty=false: Compact card with dashed border, "+" icon, text "Add provider"
// - isEmpty=true: Larger invitational card with message "Connect your first AI provider"
//
// Usage:
//   <AddProviderPlaceholderCard
//     isEmpty={false}
//     onClick={() => openAddProviderDialog()}
//   />
// ---------------------------------------------------------------------------

export const AddProviderPlaceholderCard: React.FC<AddProviderPlaceholderCardProps> = ({
  isEmpty,
  onClick,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };

  if (isEmpty) {
    // Empty state variant: larger invitational card
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        className={cn(
          "border-dashed",
          "cursor-pointer select-none transition-colors",
          "hover:border-primary/40 hover:bg-accent/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
        aria-label="Connect your first AI provider"
      >
        <CardContent className="flex items-center justify-center py-8">
          <div className="space-y-2 text-center">
            <Plus className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Connect your first AI provider
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Compact variant: small card with dashed border
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex flex-row items-center gap-3 px-3 py-2.5",
        "border-dashed",
        "cursor-pointer select-none transition-colors",
        "hover:border-primary/40 hover:bg-accent/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      )}
      aria-label="Add provider"
    >
      {/* Icon container matching ProviderCardMinimal */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-dashed bg-muted/50">
        <Plus className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Label */}
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
        Add provider
      </span>
    </Card>
  );
};
