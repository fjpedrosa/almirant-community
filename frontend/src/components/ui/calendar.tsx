"use client"

import * as React from "react"
import { buttonVariants } from "@/components/ui/button"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react"
import { DayPicker, getDefaultClassNames } from "react-day-picker"

import { cn } from "@/lib/utils"

function Calendar({
  className,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaultClassNames = getDefaultClassNames()

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn(
        "bg-background group/calendar p-3",
        className
      )}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "flex gap-4 flex-col md:flex-row relative overflow-hidden",
          defaultClassNames.months
        ),
        month: cn("flex flex-col w-full gap-4", defaultClassNames.month),
        nav: cn(
          "flex items-center gap-1 absolute top-0 inset-x-0 justify-between",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: "ghost" }),
          "size-8 p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost" }),
          "size-8 p-0 select-none aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex items-center justify-center h-8 w-full px-8",
          defaultClassNames.month_caption
        ),
        caption_label: cn(
          "select-none font-medium text-sm",
          defaultClassNames.caption_label
        ),
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "text-muted-foreground rounded-md w-8 font-normal text-[0.8rem] select-none",
          defaultClassNames.weekday
        ),
        week: cn("flex w-full mt-2", defaultClassNames.week),
        day: cn(
          "relative w-8 h-8 p-0 text-center text-sm group/day select-none",
          defaultClassNames.day
        ),
        day_button: cn(
          "relative inline-flex items-center justify-center w-8 h-8 rounded-full font-normal transition-colors",
          "hover:bg-primary hover:text-primary-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          defaultClassNames.day_button
        ),
        range_start: cn(
          "bg-primary/20",
          "[&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:!font-semibold",
          "[&>button]:!shadow-[0_0_0_2px] [&>button]:!shadow-primary/40",
          "[&>button]:hover:!bg-primary/90",
        ),
        range_middle: cn(
          "bg-primary/20",
          "[&>button]:!bg-transparent [&>button]:!text-foreground",
          "[&>button]:!rounded-none [&>button]:hover:!bg-primary/30",
        ),
        range_end: cn(
          "bg-primary/20",
          "[&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:!font-semibold",
          "[&>button]:!shadow-[0_0_0_2px] [&>button]:!shadow-primary/40",
          "[&>button]:hover:!bg-primary/90",
        ),
        selected: cn(
          "[&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:hover:!bg-primary/90",
        ),
        today: cn(
          "[&>button]:bg-accent [&>button]:text-accent-foreground",
          defaultClassNames.today
        ),
        outside: cn(
          "[&>button]:text-muted-foreground/50",
          defaultClassNames.outside
        ),
        disabled: cn(
          "[&>button]:text-muted-foreground/30 [&>button]:pointer-events-none",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
      }}
      components={{
        Chevron: ({ orientation }) => {
          if (orientation === "left") {
            return <ChevronLeftIcon className="size-4" />
          }
          return <ChevronRightIcon className="size-4" />
        },
      }}
      {...props}
    />
  )
}

Calendar.displayName = "Calendar"

export { Calendar }
