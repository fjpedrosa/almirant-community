import type { IntegrationBatchItemStatus } from "../../domain/types";

interface Props {
  status: IntegrationBatchItemStatus;
  className?: string;
}

const LABELS: Record<IntegrationBatchItemStatus, string> = {
  pending: "Pending",
  rebasing: "Rebasing",
  migrating: "Migrating",
  type_checking: "Type-checking",
  testing: "Testing",
  merged: "Merged",
  skipped: "Skipped",
  failed: "Failed",
};

const TERMINAL: IntegrationBatchItemStatus[] = ["merged", "skipped", "failed"];

const VARIANT_CLASSES: Record<"terminal" | "in_flight", string> = {
  terminal:
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground",
  in_flight:
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary animate-pulse",
};

const STATUS_TINT: Partial<Record<IntegrationBatchItemStatus, string>> = {
  merged: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  skipped: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

export const BatchStatusBadge = ({ status, className }: Props) => {
  const isTerminal = TERMINAL.includes(status);
  const baseVariant = isTerminal ? VARIANT_CLASSES.terminal : VARIANT_CLASSES.in_flight;
  const tint = STATUS_TINT[status];
  const merged = [baseVariant, tint, className].filter(Boolean).join(" ");
  return <span className={merged}>{LABELS[status]}</span>;
};
