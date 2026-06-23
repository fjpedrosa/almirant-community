"use client"

import * as React from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { format, parseISO } from "date-fns"

import { cn } from "@/lib/utils"

// Chart colors using CSS variables (oklch format from globals.css)
const PRIMARY_COLOR = "oklch(0.55 0.25 295)" // chart-1 (purple)

export interface BarTimelineChartDataItem {
  date: string // ISO date string (e.g., "2024-01-15")
  value: number
}

export interface BarTimelineChartProps {
  /** Array of data items to display */
  data: BarTimelineChartDataItem[]
  /** Optional title displayed above the chart */
  title?: string
  /** Optional className for the container */
  className?: string
  /** Height of the chart in pixels or CSS percentage (default: 300) */
  height?: number | `${number}%`
  /** Date format for X-axis (default: "MMM d") - uses date-fns format */
  dateFormat?: string
  /** Color for the bars (default: primary purple) */
  color?: string
  /** Show grid lines (default: true) */
  showGrid?: boolean
  /** Y-axis label */
  yAxisLabel?: string
  /** X-axis label */
  xAxisLabel?: string
}

/**
 * Parses and formats date for display
 */
function formatDate(dateString: string, formatString: string): string {
  try {
    const date = parseISO(dateString)
    return format(date, formatString)
  } catch {
    return dateString
  }
}

/**
 * BarTimelineChart - A bar chart component for displaying time-series data
 *
 * @example
 * ```tsx
 * <BarTimelineChart
 *   data={[
 *     { date: "2024-01-01", value: 10 },
 *     { date: "2024-01-02", value: 15 },
 *     { date: "2024-01-03", value: 12 },
 *   ]}
 *   title="Daily Signups"
 *   dateFormat="MMM d"
 * />
 * ```
 */
export function BarTimelineChart({
  data,
  title,
  className,
  height = 300,
  dateFormat = "MMM d",
  color = PRIMARY_COLOR,
  showGrid = true,
  yAxisLabel,
  xAxisLabel,
}: BarTimelineChartProps) {
  // Transform data with formatted dates for display
  const formattedData = data.map((item) => ({
    ...item,
    formattedDate: formatDate(item.date, dateFormat),
  }))

  // Create fill color with alpha for bars
  const fillColor = color.includes("/")
    ? color
    : color.replace(")", " / 70%)")

  return (
    <div className={cn("w-full", className)}>
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={formattedData}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
          {showGrid && (
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="oklch(0.20 0.02 285 / 10%)"
            />
          )}
          <XAxis
            dataKey="formattedDate"
            tick={{ fontSize: 12, fill: "currentColor" }}
            tickLine={false}
            axisLine={{ stroke: "oklch(0.20 0.02 285 / 15%)" }}
            dy={10}
            label={
              xAxisLabel
                ? {
                    value: xAxisLabel,
                    position: "bottom",
                    offset: -5,
                    fill: "currentColor",
                    fontSize: 11,
                  }
                : undefined
            }
          />
          <YAxis
            tick={{ fontSize: 12, fill: "currentColor" }}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            dx={-10}
            label={
              yAxisLabel
                ? {
                    value: yAxisLabel,
                    angle: -90,
                    position: "insideLeft",
                    fill: "currentColor",
                    fontSize: 11,
                  }
                : undefined
            }
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "oklch(1.0 0 0)",
              border: "1px solid oklch(0.20 0.02 285 / 15%)",
              borderRadius: "8px",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
            }}
            labelStyle={{ color: "oklch(0.14 0.02 285)", fontWeight: 600 }}
            itemStyle={{ color: "oklch(0.14 0.02 285)" }}
            formatter={(value) => [value, "Value"]}
            labelFormatter={(label) => `Date: ${label}`}
          />
          <Bar
            dataKey="value"
            fill={fillColor}
            stroke={color}
            strokeWidth={1}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
