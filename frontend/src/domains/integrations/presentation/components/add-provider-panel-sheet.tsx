import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, BrainCircuit, Inbox } from "lucide-react";
import { AnthropicIcon } from "@/components/icons/anthropic-icon";
import { OpenAIIcon } from "@/components/icons/openai-icon";
import { ZAIIcon } from "@/components/icons/zai-icon";
import { XAIIcon } from "@/components/icons/xai-icon";
import { PosthogIcon } from "@/components/icons/posthog-icon";
import { PlatformProviderIcon } from "@/components/icons/platform-provider-icon";
import { cn } from "@/lib/utils";
import type { AddProviderPanelSheetProps, ProviderType } from "../../domain/types";

// ---------------------------------------------------------------------------
// Provider icon resolver (local copy kept intentionally to avoid cross-component imports)
// ---------------------------------------------------------------------------

const GoogleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    role="img"
    aria-label="Google"
  >
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

const DiscordIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    role="img"
    aria-label="Discord"
  >
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const PROVIDER_ICONS: Record<ProviderType, React.FC<{ className?: string }>> = {
  github: ({ className }) => (
    <PlatformProviderIcon provider="github" className={className} size={20} />
  ),
  vercel: ({ className }) => (
    <PlatformProviderIcon provider="vercel" className={className} size={20} />
  ),
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  google: GoogleIcon,
  zai: ZAIIcon,
  xai: XAIIcon,
  sentry: ({ className }) => (
    <PlatformProviderIcon provider="sentry" className={className} size={20} />
  ),
  posthog: PosthogIcon,
  zipu: ZAIIcon,
  discord: DiscordIcon,
  gitlab: ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className} role="img" aria-label="GitLab">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51a.42.42 0 0 1 .82 0l2.44 7.51h8.06l2.44-7.51a.42.42 0 0 1 .82 0l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.94z" fill="#E24329" />
      <path d="M12 22.13L16.03 10.16H7.97L12 22.13z" fill="#FC6D26" />
      <path d="M12 22.13L7.97 10.16H1.69L12 22.13z" fill="#FCA326" />
      <path d="M1.69 10.16l-1.22 3.78a.84.84 0 0 0 .3.94L12 22.13 1.69 10.16z" fill="#E24329" />
      <path d="M1.69 10.16h6.28L5.53 2.65a.42.42 0 0 0-.82 0L1.69 10.16z" fill="#FC6D26" />
      <path d="M12 22.13l4.03-11.97h6.28L12 22.13z" fill="#FCA326" />
      <path d="M22.31 10.16l1.22 3.78a.84.84 0 0 1-.3.94L12 22.13l10.31-11.97z" fill="#E24329" />
      <path d="M22.31 10.16h-6.28l2.44-7.51a.42.42 0 0 1 .82 0l3.02 7.51z" fill="#FC6D26" />
    </svg>
  ),
};

const DEFAULT_ICON: React.FC<{ className?: string }> = BrainCircuit;

// ---------------------------------------------------------------------------
// ProviderListItem - Single clickable provider row
// ---------------------------------------------------------------------------

interface ProviderListItemProps {
  provider: ProviderType;
  name: string;
  description: string;
  onClick: () => void;
}

const ProviderListItem: React.FC<ProviderListItemProps> = ({
  provider,
  name,
  description,
  onClick,
}) => {
  const Icon = PROVIDER_ICONS[provider] ?? DEFAULT_ICON;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-3",
        "cursor-pointer select-none transition-colors",
        "hover:border-primary/40 hover:bg-accent/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      )}
      aria-label={`Add ${name}`}
    >
      {/* Icon */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
        <Icon className="h-4 w-4" />
      </div>

      {/* Text content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground line-clamp-1">{description}</p>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Empty state component
// ---------------------------------------------------------------------------

const EmptyState: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/50">
      <Inbox className="h-6 w-6 text-muted-foreground" />
    </div>
    <p className="mt-4 text-sm font-medium">All providers connected</p>
    <p className="mt-1 text-xs text-muted-foreground">
      You have already connected all available AI providers.
    </p>
  </div>
);

// ---------------------------------------------------------------------------
// AddProviderPanelSheet - Sheet displaying available AI providers to add
// ---------------------------------------------------------------------------
// Usage:
//   <AddProviderPanelSheet
//     open={isOpen}
//     onOpenChange={setIsOpen}
//     providers={availableProviders}
//     onSelectProvider={(provider) => handleConnect(provider)}
//   />
// ---------------------------------------------------------------------------

export const AddProviderPanelSheet: React.FC<AddProviderPanelSheetProps> = ({
  open,
  onOpenChange,
  providers,
  onSelectProvider,
}) => {
  const hasProviders = providers.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col p-0 sm:max-w-md"
      >
        {/* Sticky header */}
        <SheetHeader className="sticky top-0 z-10 border-b bg-background px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle className="text-base">Add AI Provider</SheetTitle>
              <SheetDescription className="text-xs">
                Select a provider to connect
              </SheetDescription>
            </div>
            <SheetClose className="rounded-sm opacity-70 transition-opacity hover:opacity-100">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </SheetClose>
          </div>
        </SheetHeader>

        {/* Scrollable content */}
        <ScrollArea className="flex-1">
          <div className="p-4">
            {hasProviders ? (
              <div className="space-y-2">
                {providers.map((provider) => (
                  <ProviderListItem
                    key={provider.provider}
                    provider={provider.provider}
                    name={provider.name}
                    description={provider.description}
                    onClick={() => onSelectProvider(provider.provider)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState />
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
