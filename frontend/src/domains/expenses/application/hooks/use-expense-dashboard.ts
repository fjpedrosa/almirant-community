"use client";

import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useActiveTeam } from "@/domains/teams/application/hooks/use-active-team";
import { expensesApi, recurringExpensesApi } from "@/lib/api/client";
import { expenseKeys } from "./use-expenses";
import { recurringSummaryKey } from "../../domain/query-keys";
import type {
  ExpenseAggregations,
  RecurringSummary,
  ExpenseByPerson,
  ExpenseByCategory,
  ExpenseTimeline,
} from "../../domain/types";

// DonutChart expects { label, value, color? }
export interface DonutDataItem {
  label: string;
  value: number;
  color?: string;
}

// AreaTimelineChart expects { date, value }
export interface TimelineDataItem {
  date: string;
  value: number;
}

// Dashboard filter params (date range, etc.)
export interface DashboardFilters {
  dateFrom?: string;
  dateTo?: string;
}

export const useExpenseDashboard = (filters?: DashboardFilters) => {
  const { confirmedActiveTeamId } = useActiveTeam();

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (filters?.dateFrom) p.set("dateFrom", filters.dateFrom);
    if (filters?.dateTo) p.set("dateTo", filters.dateTo);
    return p;
  }, [filters?.dateFrom, filters?.dateTo]);

  const aggregationsQuery = useQuery({
    queryKey: [...expenseKeys.aggregations(params.toString()), `org:${confirmedActiveTeamId ?? "none"}`],
    queryFn: () => expensesApi.getAggregations(params) as Promise<ExpenseAggregations>,
    enabled: !!confirmedActiveTeamId,
    placeholderData: keepPreviousData,
  });

  const recurringSummaryQuery = useQuery({
    // Nested under expenseKeys.recurring() so recurring-expense mutations
    // invalidate this summary (previously an orphan key that went stale).
    queryKey: [...recurringSummaryKey(), `org:${confirmedActiveTeamId ?? "none"}`],
    queryFn: () => recurringExpensesApi.summary() as Promise<RecurringSummary>,
    enabled: !!confirmedActiveTeamId,
  });

  // Transform byPerson data for DonutChart
  const personChartData = useMemo((): DonutDataItem[] => {
    if (!aggregationsQuery.data?.byPerson) return [];
    return aggregationsQuery.data.byPerson.map((p: ExpenseByPerson) => ({
      label: p.userName,
      value: parseFloat(p.totalAmount) || 0,
    }));
  }, [aggregationsQuery.data?.byPerson]);

  // Transform byCategory data for DonutChart
  const categoryChartData = useMemo((): DonutDataItem[] => {
    if (!aggregationsQuery.data?.byCategory) return [];
    return aggregationsQuery.data.byCategory.map((c: ExpenseByCategory) => ({
      label: c.categoryName,
      value: parseFloat(c.totalAmount) || 0,
      color: c.categoryColor ?? undefined,
    }));
  }, [aggregationsQuery.data?.byCategory]);

  // Transform byMonth data for AreaTimelineChart
  const timelineChartData = useMemo((): TimelineDataItem[] => {
    if (!aggregationsQuery.data?.byMonth) return [];
    // byMonth is sorted chronologically from the backend
    return aggregationsQuery.data.byMonth.map((m: ExpenseTimeline) => ({
      date: `${m.month}-01`, // Convert "YYYY-MM" to "YYYY-MM-01" for date-fns
      value: parseFloat(m.totalAmount) || 0,
    }));
  }, [aggregationsQuery.data?.byMonth]);

  return {
    isLoading: aggregationsQuery.isLoading,
    aggregations: aggregationsQuery.data ?? null,
    recurringSummary: recurringSummaryQuery.data ?? null,
    totalAmount: aggregationsQuery.data?.totalAmount ?? "0",
    recentExpenses: aggregationsQuery.data?.recentExpenses ?? [],
    personChartData,
    categoryChartData,
    timelineChartData,
  };
};
