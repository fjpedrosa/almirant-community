"use client";

import { Archive, BadgeCheck, Eye, FileEdit, XCircle, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  StatusExpandingPill,
  type StatusOption,
} from "@/domains/shared/presentation/components/status-expanding-pill";
import type { IdeaItemStatus } from "../../domain/types";

interface IdeaStatusExpandingPillProps {
  currentStatus: IdeaItemStatus;
  onStatusChange: (status: IdeaItemStatus) => void;
  isLoading?: boolean;
}

export const IdeaStatusExpandingPill: React.FC<IdeaStatusExpandingPillProps> = ({
  currentStatus,
  onStatusChange,
  isLoading,
}) => {
  const t = useTranslations("ideas");

  const IDEA_STATUS_OPTIONS: StatusOption[] = [
    {
      value: "draft",
      label: t("statuses.draft"),
      icon: FileEdit,
      color: "text-slate-700",
      bgColor: "bg-slate-100",
      borderColor: "border-slate-200",
    },
    {
      value: "active",
      label: t("statuses.active"),
      icon: Zap,
      color: "text-emerald-700",
      bgColor: "bg-emerald-100",
      borderColor: "border-emerald-200",
    },
    {
      value: "to_review",
      label: t("statuses.to_review"),
      icon: Eye,
      color: "text-blue-700",
      bgColor: "bg-blue-100",
      borderColor: "border-blue-200",
    },
    {
      value: "approved",
      label: t("statuses.approved"),
      icon: BadgeCheck,
      color: "text-violet-700",
      bgColor: "bg-violet-100",
      borderColor: "border-violet-200",
    },
    {
      value: "archived",
      label: t("statuses.archived"),
      icon: Archive,
      color: "text-gray-500",
      bgColor: "bg-gray-100",
      borderColor: "border-gray-200",
    },
    {
      value: "rejected",
      label: t("statuses.rejected"),
      icon: XCircle,
      color: "text-rose-700",
      bgColor: "bg-rose-100",
      borderColor: "border-rose-200",
    },
  ];

  return (
    <StatusExpandingPill
      currentStatus={currentStatus}
      statuses={IDEA_STATUS_OPTIONS}
      onStatusChange={(status) => onStatusChange(status as IdeaItemStatus)}
      isLoading={isLoading}
    />
  );
};
