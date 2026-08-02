"use client";

import { useState } from "react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import {
  MessageSquare,
  MoreHorizontal,
  CheckCircle2,
  XCircle,
  Play,
  Clock,
  Hammer,
  Rocket,
  RotateCcw,
  Trash2,
  Bug,
  Lightbulb,
  Sparkles,
  HelpCircle,
  Heart,
  Wand2,
  MoreHorizontal as EllipsisIcon,
} from "lucide-react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type {
  FeedbackItemsListProps,
  FeedbackStatus,
  FeedbackCategory,
  FeedbackItem,
} from "../../domain/types";

const STATUS_STYLES: Record<FeedbackStatus, string> = {
  new: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  triaged: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  in_progress: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  pending_validation: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  implementing: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  deployed: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  verified: "bg-green-500/15 text-green-400 border-green-500/20",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/20",
};

const CATEGORY_ICON: Record<FeedbackCategory, React.ReactNode> = {
  bug: <Bug className="size-3.5 text-red-400" />,
  feature_request: <Lightbulb className="size-3.5 text-amber-400" />,
  improvement: <Sparkles className="size-3.5 text-blue-400" />,
  question: <HelpCircle className="size-3.5 text-purple-400" />,
  praise: <Heart className="size-3.5 text-pink-400" />,
  other: <EllipsisIcon className="size-3.5 text-muted-foreground" />,
};

const CATEGORY_STYLES: Record<FeedbackCategory, string> = {
  bug: "bg-red-500/10 text-red-400 border-red-500/20",
  feature_request: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  improvement: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  question: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  praise: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  other: "bg-muted text-muted-foreground border-border",
};

interface StatusAction {
  targetStatus: FeedbackStatus;
  labelKey: string;
  icon: React.ReactNode;
}

const getStatusActions = (currentStatus: FeedbackStatus): StatusAction[] => {
  switch (currentStatus) {
    case "new":
      return [
        { targetStatus: "cancelled", labelKey: "cancel", icon: <XCircle className="h-4 w-4" /> },
      ];
    case "triaged":
      return [
        { targetStatus: "in_progress", labelKey: "start_work", icon: <Play className="h-4 w-4" /> },
        { targetStatus: "cancelled", labelKey: "cancel", icon: <XCircle className="h-4 w-4" /> },
      ];
    case "in_progress":
      return [
        { targetStatus: "pending_validation", labelKey: "request_validation", icon: <Clock className="h-4 w-4" /> },
        { targetStatus: "deployed", labelKey: "deploy", icon: <Rocket className="h-4 w-4" /> },
        { targetStatus: "cancelled", labelKey: "cancel", icon: <XCircle className="h-4 w-4" /> },
      ];
    case "pending_validation":
      return [
        { targetStatus: "implementing", labelKey: "approve", icon: <Hammer className="h-4 w-4" /> },
        { targetStatus: "in_progress", labelKey: "request_changes", icon: <RotateCcw className="h-4 w-4" /> },
        { targetStatus: "cancelled", labelKey: "cancel", icon: <XCircle className="h-4 w-4" /> },
      ];
    case "implementing":
      return [
        { targetStatus: "deployed", labelKey: "deploy", icon: <Rocket className="h-4 w-4" /> },
        { targetStatus: "cancelled", labelKey: "cancel", icon: <XCircle className="h-4 w-4" /> },
      ];
    case "deployed":
      return [
        { targetStatus: "verified", labelKey: "verify", icon: <CheckCircle2 className="h-4 w-4" /> },
        { targetStatus: "in_progress", labelKey: "reopen", icon: <RotateCcw className="h-4 w-4" /> },
      ];
    case "verified":
    case "cancelled":
      return [];
    default:
      return [];
  }
};

const TableSkeleton: React.FC<{ showSelectionColumn?: boolean }> = ({
  showSelectionColumn = false,
}) => (
  <>
    {Array.from({ length: 8 }).map((_, i) => (
      <TableRow key={i}>
        {showSelectionColumn && (
          <TableCell>
            <Skeleton className="h-4 w-4 rounded" />
          </TableCell>
        )}
        <TableCell>
          <Skeleton className="h-4 w-16 rounded" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-5 w-16 rounded-full" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-5 w-24 rounded-full" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-4 w-64" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-4 w-28" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-4 w-24" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-4 w-20" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-4 w-8" />
        </TableCell>
      </TableRow>
    ))}
  </>
);

interface ActionsDropdownProps {
  item: FeedbackItem;
  onStatusChange?: (id: string, status: FeedbackStatus) => void;
  onTriage?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const ActionsDropdown: React.FC<ActionsDropdownProps> = ({
  item,
  onStatusChange,
  onTriage,
  onDelete,
}) => {
  const t = useTranslations("feedback");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const statusActions = getStatusActions(item.status);
  const canTriage = item.status === "new" && !!onTriage;
  const hasActions = statusActions.length > 0 || canTriage || onDelete;

  if (!hasActions) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => e.stopPropagation()}
            aria-label="Actions"
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">{t("moderation.actions")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {canTriage && (
            <DropdownMenuItem onClick={() => onTriage?.(item.id)}>
              <Wand2 className="h-4 w-4" />
              <span className="ml-2">{t("moderation.triage")}</span>
            </DropdownMenuItem>
          )}
          {canTriage && statusActions.length > 0 && <DropdownMenuSeparator />}
          {statusActions.map((action) => (
            <DropdownMenuItem
              key={action.targetStatus}
              onClick={() => onStatusChange?.(item.id, action.targetStatus)}
            >
              {action.icon}
              <span className="ml-2">{t(`moderation.${action.labelKey}`)}</span>
            </DropdownMenuItem>
          ))}
          {onDelete && (
            <>
              {(statusActions.length > 0 || canTriage) && <DropdownMenuSeparator />}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="h-4 w-4" />
                <span className="ml-2">{t("moderation.delete")}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("moderation.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("moderation.deleteConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("moderation.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                onDelete?.(item.id);
                setDeleteDialogOpen(false);
              }}
            >
              {t("moderation.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export const FeedbackItemsList: React.FC<FeedbackItemsListProps> = ({
  items,
  isLoading,
  onStatusChange,
  onTriage,
  onDelete,
  onItemClick,
  isSelected,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  selectableItemIds,
}) => {
  const t = useTranslations("feedback");

  const showSelectionColumn = !!onToggleSelect;
  const selectableIds = selectableItemIds ?? [];
  const selectedCountInSelectable = showSelectionColumn
    ? selectableIds.reduce(
        (count, id) => (isSelected?.(id) ? count + 1 : count),
        0,
      )
    : 0;
  const allSelectableSelected =
    selectableIds.length > 0 &&
    selectedCountInSelectable === selectableIds.length;
  const someSelectableSelected =
    selectedCountInSelectable > 0 &&
    selectedCountInSelectable < selectableIds.length;
  const headerCheckedState: boolean | "indeterminate" = someSelectableSelected
    ? "indeterminate"
    : allSelectableSelected;

  const colSpan = showSelectionColumn ? 9 : 8;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {showSelectionColumn && (
            <TableHead className="w-[40px]">
              <Checkbox
                aria-label={t("moderation.selectAll")}
                checked={headerCheckedState}
                disabled={selectableIds.length === 0}
                onCheckedChange={(nextChecked) => {
                  if (nextChecked === true) {
                    onSelectAll?.(selectableIds);
                  } else {
                    onClearSelection?.();
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            </TableHead>
          )}
          <TableHead className="w-[90px]">ID</TableHead>
          <TableHead>{t("list.status")}</TableHead>
          <TableHead>{t("list.type")}</TableHead>
          <TableHead className="max-w-[350px]">{t("list.title")}</TableHead>
          <TableHead>{t("list.cluster")}</TableHead>
          <TableHead>{t("list.author")}</TableHead>
          <TableHead>{t("list.createdAt")}</TableHead>
          <TableHead className="w-[60px]">
            <span className="sr-only">{t("moderation.actions")}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableSkeleton showSelectionColumn={showSelectionColumn} />
        ) : items.length === 0 ? (
          <TableRow>
            <TableCell colSpan={colSpan} className="h-48 text-center">
              <div className="flex flex-col items-center gap-2">
                <MessageSquare className="h-8 w-8 text-muted-foreground" />
                <p className="text-muted-foreground font-medium">
                  {t("list.noItems")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("list.noItemsDescription")}
                </p>
              </div>
            </TableCell>
          </TableRow>
        ) : (
          items.map((item) => {
            const rowSelectable = item.status === "new";
            const rowSelected = isSelected?.(item.id) ?? false;
            return (
            <TableRow
              key={item.id}
              className={onItemClick ? "cursor-pointer" : undefined}
              data-state={rowSelected ? "selected" : undefined}
              onClick={() => onItemClick?.(item)}
            >
              {showSelectionColumn && (
                <TableCell
                  className={
                    !rowSelectable
                      ? "opacity-50 cursor-not-allowed"
                      : undefined
                  }
                  onClick={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    aria-label={t("moderation.selectRow")}
                    checked={rowSelected}
                    disabled={!rowSelectable}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!rowSelectable) return;
                      const mouseEvent = e as unknown as {
                        shiftKey?: boolean;
                        metaKey?: boolean;
                      };
                      onToggleSelect?.(item.id, {
                        shiftKey: mouseEvent.shiftKey,
                        metaKey: mouseEvent.metaKey,
                      });
                    }}
                  />
                </TableCell>
              )}
              {/* ID hash */}
              <TableCell>
                <code
                  className="font-mono text-xs text-muted-foreground"
                  title={item.id}
                >
                  #{item.id.slice(0, 8)}
                </code>
              </TableCell>

              {/* Status */}
              <TableCell>
                <Badge
                  variant="outline"
                  className={STATUS_STYLES[item.status]}
                >
                  {t(`statuses.${item.status}`)}
                </Badge>
              </TableCell>

              {/* Category */}
              <TableCell>
                <Badge
                  variant="outline"
                  className={`gap-1 ${CATEGORY_STYLES[item.category]}`}
                >
                  {CATEGORY_ICON[item.category]}
                  {t(`categories.${item.category}`)}
                </Badge>
              </TableCell>

              {/* Title */}
              <TableCell className="max-w-[350px]">
                <span className="font-medium line-clamp-3">{item.title}</span>
              </TableCell>

              {/* Cluster */}
              <TableCell>
                {item.cluster ? (
                  <Link
                    href={`/backoffice/feedback/clusters?clusterId=${item.cluster.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex max-w-[200px] items-center gap-1 truncate text-sm text-blue-400 hover:underline"
                    title={item.cluster.title}
                  >
                    <span className="truncate">{item.cluster.title}</span>
                  </Link>
                ) : (
                  <span className="text-sm text-muted-foreground/50">–</span>
                )}
              </TableCell>

              {/* Author */}
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {item.authorName || (
                    <span className="text-muted-foreground/50">-</span>
                  )}
                </span>
              </TableCell>

              {/* Created date */}
              <TableCell>
                <span className="text-sm text-muted-foreground">
                  {format(new Date(item.createdAt), "d MMM yyyy")}
                </span>
              </TableCell>

              {/* Actions */}
              <TableCell>
                <ActionsDropdown
                  item={item}
                  onStatusChange={onStatusChange}
                  onTriage={onTriage}
                  onDelete={onDelete}
                />
              </TableCell>
            </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
};
