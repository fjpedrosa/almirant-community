"use client";

import { Ban, CheckCircle2, Circle, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  StatusExpandingPill,
  type StatusOption,
} from "@/domains/shared/presentation/components/status-expanding-pill";
import type { TodoItemStatus } from "../../domain/types";

interface TodoStatusExpandingPillProps {
  currentStatus: TodoItemStatus;
  onStatusChange: (status: TodoItemStatus) => void;
  isLoading?: boolean;
}

export const TodoStatusExpandingPill: React.FC<TodoStatusExpandingPillProps> = ({
  currentStatus,
  onStatusChange,
  isLoading,
}) => {
  const t = useTranslations("todos");

  const TODO_STATUS_OPTIONS: StatusOption[] = [
    {
      value: "pending",
      label: t("status.pending"),
      icon: Circle,
      color: "text-amber-700",
      bgColor: "bg-amber-100",
      borderColor: "border-amber-200",
    },
    {
      value: "in_progress",
      label: t("status.in_progress"),
      icon: Play,
      color: "text-blue-700",
      bgColor: "bg-blue-100",
      borderColor: "border-blue-200",
    },
    {
      value: "done",
      label: t("status.done"),
      icon: CheckCircle2,
      color: "text-green-700",
      bgColor: "bg-green-100",
      borderColor: "border-green-200",
    },
    {
      value: "blocked",
      label: t("status.blocked"),
      icon: Ban,
      color: "text-red-700",
      bgColor: "bg-red-100",
      borderColor: "border-red-200",
    },
  ];

  return (
    <StatusExpandingPill
      currentStatus={currentStatus}
      statuses={TODO_STATUS_OPTIONS}
      onStatusChange={(status) => onStatusChange(status as TodoItemStatus)}
      isLoading={isLoading}
    />
  );
};
