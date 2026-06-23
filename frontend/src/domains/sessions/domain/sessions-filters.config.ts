import type { DynamicFiltersConfig, FilterOption } from "@/domains/shared/domain/filter-types";

const statusOptions: FilterOption[] = [
  {
    value: "queued",
    label: "Queued",
    className: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
  {
    value: "running",
    label: "Running",
    className: "border-primary/30 bg-primary/10 text-primary",
  },
  {
    value: "finalizing",
    label: "Finalizing",
    className: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  {
    value: "waiting_for_input",
    label: "Waiting for input",
    className: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    value: "paused",
    label: "Paused",
    className: "border-orange-500/40 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  {
    value: "completed",
    label: "Completed",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  {
    value: "incomplete",
    label: "Incomplete",
    className: "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  },
  {
    value: "failed",
    label: "Failed",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  {
    value: "cancelled",
    label: "Cancelled",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
];

const jobTypeOptions: FilterOption[] = [
  { value: "implementation", label: "Implementation" },
  { value: "planning", label: "Planning" },
  { value: "review", label: "Review" },
  { value: "validation", label: "Validation" },
  { value: "bug-fix", label: "Bug Fix" },
  { value: "scheduled", label: "Scheduled" },
];

export const createSessionsFiltersConfig = (
  projects: FilterOption[],
): DynamicFiltersConfig => ({
  resetPageOnChange: true,
  definitions: [
    {
      id: "projectId",
      label: "Project",
      type: "multi_select",
      operators: ["in"],
      defaultOperator: "in",
      options: projects,
    },
    {
      id: "status",
      label: "Status",
      type: "multi_select",
      operators: ["in"],
      defaultOperator: "in",
      options: statusOptions,
    },
    {
      id: "jobType",
      label: "Session type",
      type: "multi_select",
      operators: ["in"],
      defaultOperator: "in",
      options: jobTypeOptions,
    },
    {
      id: "taskId",
      label: "Task ID",
      type: "text",
      operators: ["contains"],
      placeholder: "Search by task ID...",
    },
  ],
});
