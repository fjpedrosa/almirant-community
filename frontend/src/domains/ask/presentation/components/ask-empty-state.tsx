import { MessageCircleQuestion } from "lucide-react";

// ---------------------------------------------------------------------------
// Component: AskEmptyState
// ---------------------------------------------------------------------------
// Empty state placeholder for when no questions have been asked yet.
// ---------------------------------------------------------------------------

export interface AskEmptyStateProps {
  title: string;
  description: string;
}

export const AskEmptyState: React.FC<AskEmptyStateProps> = ({
  title,
  description,
}) => {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-muted">
        <MessageCircleQuestion className="size-8 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
};
