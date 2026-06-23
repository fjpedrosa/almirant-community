import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CloseSprintDialogProps } from "../../domain/types";
import { buildDoneItemsTree } from "../../application/utils/build-done-items-tree";
import { DoneItemsTree } from "./done-items-tree";

export const CloseSprintDialog: React.FC<CloseSprintDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
  onConfirmByDateRange,
  isPending,
  doneItems,
  isLoadingPreview,
  isAdHoc,
  suggestedName,
  activeSprintName,
  dateRange,
  onDateRangeChange,
  dateRangeDoneItems,
  isLoadingDateRangePreview,
}) => {
  const t = useTranslations("sprints.close");
  const tCommon = useTranslations("common");
  const { formatShort, locale } = useFormattedDate();
  const [adHocName, setAdHocName] = useState(suggestedName);
  const [dateRangeName, setDateRangeName] = useState(suggestedName);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [hoveredDay, setHoveredDay] = useState<Date | undefined>(undefined);

  const allTreeItems = useMemo(() => buildDoneItemsTree(doneItems), [doneItems]);
  const dateRangeTreeItems = useMemo(() => buildDoneItemsTree(dateRangeDoneItems), [dateRangeDoneItems]);

  const hasDateRange = !!dateRange.from && !!dateRange.to;
  const isRangeComplete =
    hasDateRange &&
    dateRange.from!.getTime() !== dateRange.to!.getTime();
  const canCloseByDate = hasDateRange && dateRangeName.trim().length > 0;

  // Build a visual range for hover feedback while picking the end date
  const isPickingEnd = !!dateRange.from && !isRangeComplete;
  const visualRange = isPickingEnd && hoveredDay && hoveredDay.getTime() !== dateRange.from!.getTime()
    ? hoveredDay > dateRange.from!
      ? { from: dateRange.from!, to: hoveredDay }
      : { from: hoveredDay, to: dateRange.from! }
    : dateRange.from ? dateRange : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {isAdHoc
              ? t("descAdHoc")
              : t("descActive", { name: activeSprintName ?? "" })}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
          <TabsList className="w-full">
            <TabsTrigger value="all" className="flex-1">
              {t("allTasks")}
            </TabsTrigger>
            <TabsTrigger value="by-date" className="flex-1">
              {t("byDateRange")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="mt-4 flex flex-col gap-4 flex-1 min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
              {isAdHoc && (
                <div className="space-y-2">
                  <Label htmlFor="adhoc-name">{t("sprintName")}</Label>
                  <Input
                    id="adhoc-name"
                    value={adHocName}
                    onChange={(e) => setAdHocName(e.target.value)}
                    placeholder={suggestedName}
                  />
                </div>
              )}

              <div>
                <p className="text-sm font-medium mb-2">
                  {t("completedTasks", { count: doneItems.length })}
                </p>
                <DoneItemsTree items={allTreeItems} isLoading={isLoadingPreview} />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button
                onClick={() => onConfirm(isAdHoc ? adHocName.trim() || suggestedName : undefined)}
                disabled={isPending}
              >
                {isPending
                  ? t("closing")
                  : doneItems.length > 0
                    ? t("closeWithCount", { count: doneItems.length })
                    : t("closeButton")}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="by-date" className="mt-4 flex flex-col gap-4 flex-1 min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="date-range-name">{t("sprintName")}</Label>
                <Input
                  id="date-range-name"
                  value={dateRangeName}
                  onChange={(e) => setDateRangeName(e.target.value)}
                  placeholder={suggestedName}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-2.5 transition-colors",
                    !dateRange.from
                      ? "border-primary ring-2 ring-primary/20 bg-primary/5"
                      : "bg-muted/30"
                  )}
                >
                  <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground leading-tight">{t("startDate")}</p>
                    <p className={cn("text-sm font-medium truncate", !dateRange.from && "text-muted-foreground")}>
                      {dateRange.from ? formatShort(dateRange.from) : tCommon("select")}
                    </p>
                  </div>
                </div>
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-2.5 transition-colors",
                    dateRange.from && !isRangeComplete
                      ? "border-primary ring-2 ring-primary/20 bg-primary/5"
                      : "bg-muted/30"
                  )}
                >
                  <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground leading-tight">{t("endDate")}</p>
                    <p className={cn("text-sm font-medium truncate", !isRangeComplete && "text-muted-foreground")}>
                      {isRangeComplete ? formatShort(dateRange.to!) : tCommon("select")}
                    </p>
                  </div>
                </div>
              </div>

              <Calendar
                mode="range"
                selected={visualRange}
                onSelect={() => {/* noop: forces rdp into controlled mode so it uses our selected prop */}}
                onDayClick={(day) => {
                  if (!dateRange.from || isRangeComplete) {
                    // Start a new range
                    onDateRangeChange({ from: day, to: day });
                  } else {
                    // Complete the range (sort so from < to)
                    const sorted = day >= dateRange.from
                      ? { from: dateRange.from, to: day }
                      : { from: day, to: dateRange.from };
                    onDateRangeChange(sorted);
                  }
                  setHoveredDay(undefined);
                }}
                onDayMouseEnter={(day) => {
                  if (isPickingEnd) setHoveredDay(day);
                }}
                onDayMouseLeave={() => setHoveredDay(undefined)}
                numberOfMonths={2}
                locale={locale}
                className="bg-background mx-auto !p-0"
              />

              {hasDateRange && (
                <div>
                  <p className="text-sm font-medium mb-2">
                    {t("tasksInRange", { count: dateRangeDoneItems.length })}
                  </p>
                  <DoneItemsTree
                    items={dateRangeTreeItems}
                    isLoading={isLoadingDateRangePreview}
                  />
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button
                onClick={() => {
                  if (canCloseByDate && dateRange.from && dateRange.to) {
                    const formatLocal = (d: Date) =>
                      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                    onConfirmByDateRange({
                      name: dateRangeName.trim() || suggestedName,
                      startDate: formatLocal(dateRange.from),
                      endDate: formatLocal(dateRange.to),
                    });
                  }
                }}
                disabled={isPending || !canCloseByDate}
              >
                {isPending
                  ? t("closing")
                  : hasDateRange && dateRangeDoneItems.length > 0
                    ? t("closeByDateWithCount", { count: dateRangeDoneItems.length })
                    : t("closeByDate")}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
