"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatLocalDate, monthCalendarDays, weekdayLabels, weekStartsOnForLocale } from "../../domain/date";

const defaultDayLabel = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year!, month! - 1, day!, 12).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

export const AgendaCalendar = ({
  month,
  selectedDate,
  daysWithNotes,
  labels,
  onSelectDate,
  onPreviousMonth,
  onNextMonth,
  locale = "en",
  dayLabel = defaultDayLabel,
}: {
  month: string;
  selectedDate: string;
  daysWithNotes: string[];
  labels: { calendar: string; previous: string; next: string; noted?: string };
  onSelectDate: (date: string) => void;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  locale?: string;
  dayLabel?: (date: string) => string;
}) => {
  const noted = new Set(daysWithNotes);
  const days = monthCalendarDays(month, weekStartsOnForLocale(locale));
  const [focusIndex, setFocusIndex] = useState(() => Math.max(0, days.findIndex((day) => day.date === selectedDate)));
  const dayRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = days.findIndex((day) => day.date === selectedDate);
  const activeFocusIndex = focusIndex >= days.length ? Math.max(0, selectedIndex) : focusIndex;
  const rows = Array.from({ length: Math.ceil(days.length / 7) }, (_, row) => days.slice(row * 7, row * 7 + 7));
  const moveFocus = (index: number) => {
    const next = (index + days.length) % days.length;
    setFocusIndex(next);
    dayRefs.current[next]?.focus();
  };
  const today = formatLocalDate();
  const weekdays = weekdayLabels(locale);
  return (
    <section aria-label={labels.calendar} data-notes-calendar className="px-3 py-4">
      <header className="mb-3 flex items-center justify-between">
        <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.previous} onClick={onPreviousMonth}>
          <ChevronLeft className="size-4" />
        </Button>
        <h2 className="text-sm font-semibold">{labels.calendar}</h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.next} onClick={onNextMonth}>
          <ChevronRight className="size-4" />
        </Button>
      </header>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={labels.calendar}>
        <div role="row" className="contents">
          {weekdays.map((weekday) => <span key={weekday} role="columnheader" className="text-center text-[11px] font-medium text-muted-foreground">{weekday}</span>)}
        </div>
        {rows.map((row, rowIndex) => <div key={`row-${rowIndex}`} role="row" className="contents">{row.map(({ date, inMonth }, rowOffset) => {
          const index = rowIndex * 7 + rowOffset;
          const selected = date === selectedDate;
          const hasNotes = noted.has(date);
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              aria-label={dayLabel(date)}
              aria-selected={selected}
              aria-current={date === today ? "date" : undefined}
              aria-describedby={hasNotes ? `${date}-note-indicator` : undefined}
              tabIndex={index === activeFocusIndex ? 0 : -1}
              onClick={() => onSelectDate(date)}
              onKeyDown={(event) => {
                const rowStart = Math.floor(index / 7) * 7;
                const rowEnd = Math.min(rowStart + 6, days.length - 1);
                const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7 : event.key === "Home" ? rowStart - index : event.key === "End" ? rowEnd - index : 0;
                if (!delta && event.key !== "Home" && event.key !== "End") return;
                event.preventDefault();
                moveFocus(index + delta);
              }}
              ref={(element) => { dayRefs.current[index] = element; }}
              className={cn(
                "relative flex aspect-square min-h-8 items-center justify-center rounded-md text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                inMonth ? "text-foreground" : "text-muted-foreground",
                selected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
              )}
            >
              {Number(date.slice(-2))}
              {hasNotes && (
                <>
                  <span aria-hidden="true" className={cn("absolute bottom-1 size-1 rounded-full", selected ? "bg-primary-foreground" : "bg-primary")} />
                  <span id={`${date}-note-indicator`} className="sr-only">{labels.noted ?? labels.calendar}</span>
                </>
              )}
            </button>
          );
        })}</div>)}
      </div>
    </section>
  );
};
