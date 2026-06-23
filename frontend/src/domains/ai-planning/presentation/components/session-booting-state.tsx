import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

// Usage:
// <SessionBootingState messageKey="booting.preparing" />
// Shown while a planning session is being created and started.
// The message rotation logic lives in the parent container via useBootingMessages.

interface SessionBootingStateProps {
  messageKey: string;
}

export const SessionBootingState: React.FC<SessionBootingStateProps> = ({
  messageKey,
}) => {
  const t = useTranslations("aiPlanning");

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <Loader2 className="size-10 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground animate-pulse motion-reduce:animate-none">
        {t(messageKey)}
      </p>
    </div>
  );
};
