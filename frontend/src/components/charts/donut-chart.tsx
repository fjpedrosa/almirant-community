"use client"

import * as React from "react"
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts"

import { cn } from "@/lib/utils"

// Chart colors using CSS variables (oklch format from globals.css)
const CHART_COLORS = [
  "oklch(0.55 0.25 295)", // chart-1 (purple)
  "oklch(0.596 0.17 162.48)", // chart-2 (green)
  "oklch(0.669 0.188 70.08)", // chart-3 (yellow/orange)
  "oklch(0.527 0.265 303.9)", // chart-4 (pink/purple)
  "oklch(0.545 0.246 16.439)", // chart-5 (red)
]

export interface DonutChartDataItem {
  label: string
  value: number
  color?: string
}

export interface DonutChartProps {
  /** Array of data items to display */
  data: DonutChartDataItem[]
  /** Optional title displayed above the chart */
  title?: string
  /** Optional className for the container */
  className?: string
  /** Height of the chart in pixels (default: 300) */
  height?: number
  /** Show legend (default: true) */
  showLegend?: boolean
  /** Inner radius as percentage (default: 60) */
  innerRadius?: number
  /** Outer radius as percentage (default: 80) */
  outerRadius?: number
  /** Center text (e.g., total value) */
  centerText?: string
  /** Center subtext (e.g., "Total") */
  centerSubtext?: string
}

/**
 * DonutChart - A donut/pie chart component for displaying proportional data
 *
 * @example
 * ```tsx
 * <DonutChart
 *   data={[
 *     { label: "Completed", value: 45 },
 *     { label: "In Progress", value: 30 },
 *     { label: "Pending", value: 25 },
 *   ]}
 *   title="Task Status"
 *   centerText="100"
 *   centerSubtext="Total"
 * />
 * ```
 */
export function DonutChart({
  data,
  title,
  className,
  height = 300,
  showLegend = true,
  innerRadius = 60,
  outerRadius = 80,
  centerText,
  centerSubtext,
}: DonutChartProps) {
  // Assign colors to data
  const dataWithColors = data.map((item, index) => ({
    ...item,
    resolvedColor: item.color || CHART_COLORS[index % CHART_COLORS.length],
  }))

  return (
    <div className={cn("w-full", className)}>
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
      )}
      <div className="relative">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={dataWithColors}
              cx="50%"
              cy="50%"
              innerRadius={`${innerRadius}%`}
              outerRadius={`${outerRadius}%`}
              paddingAngle={2}
              dataKey="value"
              nameKey="label"
            >
              {dataWithColors.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.resolvedColor}
                  stroke="transparent"
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "oklch(1.0 0 0)",
                border: "1px solid oklch(0.20 0.02 285 / 15%)",
                borderRadius: "8px",
                boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              }}
              itemStyle={{ color: "oklch(0.14 0.02 285)" }}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center text overlay */}
        {(centerText || centerSubtext) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              {centerText && (
                <div className="text-2xl font-bold text-foreground">
                  {centerText}
                </div>
              )}
              {centerSubtext && (
                <div className="text-xs text-muted-foreground">
                  {centerSubtext}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Custom legend with values and percentages */}
      {showLegend && (
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 mt-4">
          {(() => {
            const total = dataWithColors.reduce((sum, item) => sum + item.value, 0)
            return dataWithColors.map((entry, index) => {
              const pct = total > 0 ? ((entry.value / total) * 100).toFixed(1) : "0"
              return (
                <li key={`legend-${index}`} className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: entry.resolvedColor }}
                  />
                  <span className="text-sm text-muted-foreground">
                    {entry.label}
                    <span className="ml-1 font-medium text-foreground">{entry.value}</span>
                    <span className="ml-0.5 text-xs">({pct}%)</span>
                  </span>
                </li>
              )
            })
          })()}
        </ul>
      )}
    </div>
  )
}
