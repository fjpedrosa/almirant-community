"use client"

import * as React from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
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

interface DataItemWithPercentage {
  label: string
  value: number
  color?: string
  percentage: string
  subtitle: string
}

export interface DistributionBarChartDataItem {
  label: string
  value: number
  color?: string
}

export interface DistributionBarChartProps {
  /** Array of data items to display */
  data: DistributionBarChartDataItem[]
  /** Optional title displayed above the chart */
  title?: string
  /** Optional className for the container */
  className?: string
  /** Height of the chart in pixels (default: 300) */
  height?: number
  /** Show percentage labels (default: true) */
  showPercentage?: boolean
  /** Show value labels (default: true) */
  showValue?: boolean
  /** Optional map of label keys to tooltip descriptions */
  tooltipMap?: Record<string, string>
}

/**
 * Calculates percentage for each data item
 */
function calculatePercentages(data: DistributionBarChartDataItem[]): DataItemWithPercentage[] {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  return data.map((item) => {
    const percentage = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0"
    return {
      ...item,
      percentage,
      subtitle: `${item.value} • ${percentage}%`,
    }
  })
}

/**
 * Custom tooltip component for the bar chart
 */
interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{
    payload: DataItemWithPercentage
  }>
  tooltipMap?: Record<string, string>
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ active, payload, tooltipMap }) => {
  if (!active || !payload || payload.length === 0) return null

  const data = payload[0].payload
  const tooltipText = tooltipMap?.[data.label]

  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-medium">{data.label}</p>
      <p className="text-muted-foreground">
        {data.value} ({data.percentage}%)
      </p>
      {tooltipText && (
        <p className="mt-1 text-xs text-muted-foreground">{tooltipText}</p>
      )}
    </div>
  )
}

/**
 * Custom Y-axis tick that renders the label on the first line
 * and the value/percentage subtitle on a second line below it.
 */
interface CustomTickProps {
  x: number
  y: number
  payload: { value: string }
  dataMap: Map<string, string>
  showValue: boolean
  showPercentage: boolean
}

const CustomYAxisTick: React.FC<CustomTickProps> = ({
  x,
  y,
  payload,
  dataMap,
}) => {
  const subtitle = dataMap.get(payload.value) ?? ""
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={-6}
        textAnchor="end"
        fill="currentColor"
        fontSize={12}
      >
        {payload.value}
      </text>
      <text
        x={0}
        y={10}
        textAnchor="end"
        fill="oklch(0.55 0.01 285)"
        fontSize={11}
      >
        {subtitle}
      </text>
    </g>
  )
}

/**
 * DistributionBarChart - A horizontal bar chart component for displaying distribution data
 *
 * @example
 * ```tsx
 * <DistributionBarChart
 *   data={[
 *     { label: "Category A", value: 45 },
 *     { label: "Category B", value: 30 },
 *     { label: "Category C", value: 25 },
 *   ]}
 *   title="Distribution by Category"
 * />
 * ```
 */
export function DistributionBarChart({
  data,
  title,
  className,
  height = 300,
  showPercentage = true,
  showValue = true,
  tooltipMap,
}: DistributionBarChartProps) {
  const dataWithLabels = calculatePercentages(data).map((item) => {
    const parts: string[] = []
    if (showValue) parts.push(item.value.toString())
    if (showPercentage) parts.push(`${item.percentage}%`)
    return {
      ...item,
      subtitle: parts.join(" • "),
    }
  })

  // Build a lookup map: label → subtitle for the custom tick
  const dataMap = new Map(dataWithLabels.map((d) => [d.label, d.subtitle]))

  return (
    <div className={cn("w-full", className)}>
      {title && (
        <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          layout="vertical"
          data={dataWithLabels}
          margin={{ right: 10 }}
        >
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={130}
            tick={(props: Record<string, unknown>) => (
              <CustomYAxisTick
                {...(props as unknown as Omit<CustomTickProps, "dataMap" | "showValue" | "showPercentage">)}
                dataMap={dataMap}
                showValue={showValue}
                showPercentage={showPercentage}
              />
            )}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={<CustomTooltip tooltipMap={tooltipMap} />}
            cursor={{ fill: "oklch(0.94 0.005 285)", opacity: 0.5 }}
          />
          <Bar
            dataKey="value"
            radius={4}
            background={{ fill: "oklch(0.94 0.005 285)", radius: 4 }}
          >
            {dataWithLabels.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.color || CHART_COLORS[index % CHART_COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
