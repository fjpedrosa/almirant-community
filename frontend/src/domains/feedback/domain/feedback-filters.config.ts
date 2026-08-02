import type { DynamicFiltersConfig, FilterOption } from "@/domains/shared/domain/filter-types";
import type { FeedbackStatus, FeedbackCategory } from "./types";

const statusOptions: FilterOption[] = [
  { value: "new" satisfies FeedbackStatus, label: "New" },
  { value: "triaged" satisfies FeedbackStatus, label: "Triaged" },
  { value: "in_progress" satisfies FeedbackStatus, label: "In Progress" },
  { value: "pending_validation" satisfies FeedbackStatus, label: "Pending Validation" },
  { value: "implementing" satisfies FeedbackStatus, label: "Implementing" },
  { value: "deployed" satisfies FeedbackStatus, label: "Deployed" },
  { value: "verified" satisfies FeedbackStatus, label: "Verified" },
  { value: "cancelled" satisfies FeedbackStatus, label: "Cancelled" },
];

const categoryOptions: FilterOption[] = [
  { value: "bug" satisfies FeedbackCategory, label: "Bug" },
  { value: "feature_request" satisfies FeedbackCategory, label: "Feature Request" },
  { value: "improvement" satisfies FeedbackCategory, label: "Improvement" },
  { value: "question" satisfies FeedbackCategory, label: "Question" },
  { value: "praise" satisfies FeedbackCategory, label: "Praise" },
  { value: "other" satisfies FeedbackCategory, label: "Other" },
];

export const createFeedbackFiltersConfig = (): DynamicFiltersConfig => ({
  initialFilters: [],
  definitions: [
    {
      id: "status",
      label: "Status",
      type: "select",
      operators: ["equals"],
      options: statusOptions,
      group: "Feedback",
    },
    {
      id: "category",
      label: "Category",
      type: "select",
      operators: ["equals"],
      options: categoryOptions,
      group: "Feedback",
    },
  ],
  searchPlaceholder: "Search by title or content...",
});
