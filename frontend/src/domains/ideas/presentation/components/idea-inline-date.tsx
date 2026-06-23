import { format } from "date-fns";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { CalendarDays, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { IdeaInlineDateProps } from "../../domain/types";

export const IdeaInlineDate: React.FC<IdeaInlineDateProps> = ({
  value,
  onChange,
  isLoading = false,
}) => {
  const { formatShort, locale } = useFormattedDate();
  
  const parseDate = (value: string | null): Date | undefined => {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md px-1.5 py-1">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          {value ? formatShort(value) : "Sin fecha"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={parseDate(value)}
          onSelect={(date: Date | undefined) =>
            onChange(date ? format(date, "yyyy-MM-dd") : null)
          }
          locale={locale}
        />
        {value && (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => onChange(null)}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Limpiar fecha
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
