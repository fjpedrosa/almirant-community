import { Button } from "@/components/ui/button";

interface Props {
  validatingItemCount: number;
  hasActiveBatch: boolean;
  isLoading: boolean;
  onTrigger: () => void;
  className?: string;
}

export const TriggerBatchButton = ({
  validatingItemCount,
  hasActiveBatch,
  isLoading,
  onTrigger,
  className,
}: Props) => {
  const disabled = hasActiveBatch || isLoading || validatingItemCount === 0;
  const label = hasActiveBatch
    ? "Batch in progress"
    : `Integrate batch (${validatingItemCount})`;
  return (
    <Button
      type="button"
      size="sm"
      variant="default"
      disabled={disabled}
      onClick={onTrigger}
      className={className}
    >
      {label}
    </Button>
  );
};
