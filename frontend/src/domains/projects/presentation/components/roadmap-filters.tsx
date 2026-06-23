"use client";

import { format } from "date-fns";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { RoadmapFiltersProps, RoadmapStatusFilter } from "../../domain/types";

const STATUS_OPTIONS: RoadmapStatusFilter[] = [
  "all",
  "in-progress",
  "completed",
  "planned",
];

export const RoadmapFilters: React.FC<RoadmapFiltersProps> = ({
  projectId,
  epicId,
  dateFrom,
  dateTo,
  status,
  projectOptions,
  epicOptions,
  onProjectChange,
  onEpicChange,
  onDateFromChange,
  onDateToChange,
  onStatusChange,
  onClearFilters,
  hasActiveFilters,
}) => {
  const t = useTranslations("roadmap.filters");
  const tCommon = useTranslations("common");
  const { locale } = useFormattedDate();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Project selector */}
      <Select value={projectId} onValueChange={onProjectChange}>
        <SelectTrigger size="sm" className="w-[180px]">
          <SelectValue placeholder={t("allProjects")} />
        </SelectTrigger>
        <SelectContent>
          {projectOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Epic selector */}
      <Select
        value={epicId ?? "__all__"}
        onValueChange={(val) =>
          onEpicChange(val === "__all__" ? undefined : val)
        }
      >
        <SelectTrigger size="sm" className="w-[180px]">
          <SelectValue placeholder={t("allEpics")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{t("allEpics")}</SelectItem>
          {epicOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Date from */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "w-[150px] justify-start text-left font-normal",
              !dateFrom && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-3.5 w-3.5" />
            {dateFrom ? format(dateFrom, "dd/MM/yyyy") : t("from")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={dateFrom ?? undefined}
            onSelect={(date) => onDateFromChange(date ?? null)}
            disabled={(date) => (dateTo ? date > dateTo : false)}
            locale={locale}
          />
        </PopoverContent>
      </Popover>

      {/* Date to */}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "w-[150px] justify-start text-left font-normal",
              !dateTo && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="mr-2 h-3.5 w-3.5" />
            {dateTo ? format(dateTo, "dd/MM/yyyy") : t("to")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={dateTo ?? undefined}
            onSelect={(date) => onDateToChange(date ?? null)}
            disabled={(date) => (dateFrom ? date < dateFrom : false)}
            locale={locale}
          />
        </PopoverContent>
      </Popover>

      {/* Status filter */}
      <Select
        value={status}
        onValueChange={(val) => onStatusChange(val as RoadmapStatusFilter)}
      >
        <SelectTrigger size="sm" className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {t(`status.${opt}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Clear filters */}
      {hasActiveFilters && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
          className="text-muted-foreground"
        >
          <X className="mr-1 h-3.5 w-3.5" />
          {tCommon("clearFilters")}
        </Button>
      )}
    </div>
  );
};
