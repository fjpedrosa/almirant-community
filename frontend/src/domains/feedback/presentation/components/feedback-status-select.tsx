import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { FeedbackStatus } from "../../domain/types";

interface FeedbackStatusSelectProps {
  value: FeedbackStatus;
  onValueChange: (status: FeedbackStatus) => void;
  disabled?: boolean;
}

const ALL_STATUSES: FeedbackStatus[] = [
  "new",
  "triaged",
  "in_progress",
  "pending_validation",
  "implementing",
  "deployed",
  "verified",
  "cancelled",
];

const STATUS_DOT_CLASS: Record<FeedbackStatus, string> = {
  new: "bg-blue-500",
  triaged: "bg-slate-500",
  in_progress: "bg-yellow-500",
  pending_validation: "bg-orange-500",
  implementing: "bg-indigo-500",
  deployed: "bg-emerald-500",
  verified: "bg-green-600",
  cancelled: "bg-red-500",
};

export const FeedbackStatusSelect: React.FC<FeedbackStatusSelectProps> = ({
  value,
  onValueChange,
  disabled = false,
}) => {
  const t = useTranslations("feedback");

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger size="sm" className="h-7 gap-1.5 text-xs font-medium px-2">
        <SelectValue>
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-2 w-2 rounded-full shrink-0",
                STATUS_DOT_CLASS[value]
              )}
            />
            {t(`statuses.${value}`)}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {ALL_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            <span className="flex items-center gap-1.5">
              <span
                className={cn(
                  "h-2 w-2 rounded-full shrink-0",
                  STATUS_DOT_CLASS[status]
                )}
              />
              {t(`statuses.${status}`)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
