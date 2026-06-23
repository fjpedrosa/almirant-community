/**
 * Reusable chart components built with Recharts
 *
 * These components are designed to be purely presentational:
 * - NO useState, NO useEffect, NO hooks
 * - Props in, JSX out
 *
 * @example
 * ```tsx
 * import { DistributionBarChart, DonutChart, AreaTimelineChart } from "@/components/charts"
 * ```
 */

export { DistributionBarChart, type DistributionBarChartDataItem, type DistributionBarChartProps } from "./distribution-bar-chart"
export { DonutChart, type DonutChartDataItem, type DonutChartProps } from "./donut-chart"
export { AreaTimelineChart, type AreaTimelineChartDataItem, type AreaTimelineChartProps } from "./area-timeline-chart"
export { BarTimelineChart, type BarTimelineChartDataItem, type BarTimelineChartProps } from "./bar-timeline-chart"
