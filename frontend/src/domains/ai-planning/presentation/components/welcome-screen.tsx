import type React from "react";
import { Loader2, Bot } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { WelcomeScreenProps, BootPhase } from "../../domain/types";

// ---------------------------------------------------------------------------
// Boot phase labels
// ---------------------------------------------------------------------------

const BOOT_PHASE_LABELS: Record<BootPhase, string> = {
  connecting: "Conectando...",
  preparing: "Preparando el entorno...",
  almost_ready: "Casi listo...",
};

// ---------------------------------------------------------------------------
// WelcomeScreen — presentational component
// ---------------------------------------------------------------------------

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  welcomeMessage,
  isLoadingWelcome,
  bootPhase,
  suggestions,
  onSuggestionClick,
}) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 max-w-2xl mx-auto w-full">
      {/* Welcome message bubble */}
      <Card className="w-full p-4">
        <div className="flex gap-3">
          <div className="flex-shrink-0 size-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="size-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            {isLoadingWelcome ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ) : (
              <p className="text-sm text-foreground leading-relaxed">
                {welcomeMessage}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Boot phase indicator */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="text-xs">{BOOT_PHASE_LABELS[bootPhase]}</span>
      </div>

      {/* Suggestion chips */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion}
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => onSuggestionClick(suggestion)}
          >
            {suggestion}
          </Button>
        ))}
      </div>
    </div>
  );
};
