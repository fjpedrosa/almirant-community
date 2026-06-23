import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AgentQuestionToastProps {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  onDismiss: () => void;
}

export const AgentQuestionToast: React.FC<AgentQuestionToastProps> = ({
  title,
  description,
  actionLabel,
  onAction,
  onDismiss,
}) => (
  <div className="relative flex gap-3 rounded-lg border border-amber-700/30 bg-amber-950/50 p-4">
    {/* Left column: icon */}
    <div className="flex items-start pt-0.5">
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400/70" />
    </div>

    {/* Right column: text + action */}
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-1 pr-6">
        <span className="text-sm font-medium text-amber-200">{title}</span>
        <span className="text-sm text-amber-300/70">{description}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onAction}
        className="w-fit border-amber-600/40 text-amber-200 hover:bg-amber-900/40 hover:text-amber-100"
      >
        {actionLabel}
      </Button>
    </div>

    {/* Close button in top-right corner */}
    <button
      type="button"
      onClick={onDismiss}
      className="absolute right-2 top-2 rounded p-1 text-amber-500/50 transition-colors hover:text-amber-300"
      aria-label="Dismiss"
    >
      <X className="h-4 w-4" />
    </button>
  </div>
);
