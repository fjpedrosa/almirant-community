"use client";

import type { KeyboardEvent, ReactNode, SyntheticEvent } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import type { ClusterRow } from "../../domain/types";
import { ClusterStatusBadge } from "./cluster-status-badge";

const DISABLED_SELECTION_TOOLTIP = "Estado no permite lanzar investigación";

/**
 * Responsive data table for feedback-triage clusters.
 *
 * Desktop (md+): shadcn Table with clickable rows.
 * Mobile (<md): vertical stack of Cards with the same fields and interactions.
 *
 * Pure presentational component — no state, no effects. All logic lives in the
 * container/hook that owns the `rows`, `isLoading`, and `onOpenDetail` handler.
 *
 * @example
 * <ClustersDataTable
 *   rows={rows}
 *   isLoading={isLoading}
 *   onOpenDetail={(cluster) => router.push(`/feedback/clusters/${cluster.id}`)}
 *   renderActions={(cluster) => <ClusterActionsMenu cluster={cluster} />}
 * />
 */
export interface ClustersDataTableProps {
  rows: ClusterRow[];
  isLoading: boolean;
  onOpenDetail: (cluster: ClusterRow) => void;
  renderActions?: (cluster: ClusterRow) => ReactNode;
  // Optional selection API — when all three of `selectedIds`, `onToggleRow`,
  // and `onToggleAllVisible` are provided the table renders a leading checkbox
  // column (desktop) and a top-right checkbox on each card (mobile). If any of
  // the three is missing the selection UI is omitted so existing callsites
  // continue to render unchanged.
  selectedIds?: Set<string>;
  onToggleRow?: (clusterId: string) => void;
  onToggleAllVisible?: (clusterIds: string[], nextSelected: boolean) => void;
  getIsSelectable?: (cluster: ClusterRow) => boolean;
}

const handleRowKeyDown = (
  event: KeyboardEvent<HTMLElement>,
  cluster: ClusterRow,
  onOpenDetail: (cluster: ClusterRow) => void,
) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onOpenDetail(cluster);
  }
};

const stopPropagation = (event: SyntheticEvent<HTMLElement>) => {
  event.stopPropagation();
};

const TableSkeleton: React.FC<{ showSelectionColumn?: boolean }> = ({
  showSelectionColumn = false,
}) => (
  <>
    {Array.from({ length: 5 }).map((_, i) => (
      <TableRow key={i}>
        {showSelectionColumn ? (
          <TableCell>
            <Skeleton className="h-4 w-4 rounded-sm" />
          </TableCell>
        ) : null}
        <TableCell>
          <Skeleton className="h-4 w-40" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-4 w-32" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-5 w-24" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-4 w-10" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-4 w-16" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-4 w-24" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-8 w-8 rounded-md" />
        </TableCell>
      </TableRow>
    ))}
  </>
);

const CardSkeleton: React.FC = () => (
  <div className="space-y-3">
    {Array.from({ length: 3 }).map((_, i) => (
      <div key={i} className="rounded-lg border p-4 space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-32" />
        <div className="flex justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="flex justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
    ))}
  </div>
);

export const ClustersDataTable: React.FC<ClustersDataTableProps> = ({
  rows,
  isLoading,
  onOpenDetail,
  renderActions,
  selectedIds,
  onToggleRow,
  onToggleAllVisible,
  getIsSelectable,
}) => {
  const { formatShort } = useFormattedDate();

  const isEmpty = !isLoading && rows.length === 0;

  // Selection UI is opt-in: rendered only when the full trio of
  // `selectedIds`, `onToggleRow`, and `onToggleAllVisible` is provided. This
  // keeps existing callsites (that pass none of them) visually unchanged.
  const showSelectionColumn = Boolean(
    selectedIds && onToggleRow && onToggleAllVisible,
  );

  const isRowSelectable = getIsSelectable ?? (() => true);

  const selectableRows = showSelectionColumn
    ? rows.filter(isRowSelectable)
    : [];
  const allSelected =
    showSelectionColumn &&
    selectableRows.length > 0 &&
    selectableRows.every((row) => selectedIds!.has(row.id));
  const someSelected =
    showSelectionColumn &&
    selectableRows.some((row) => selectedIds!.has(row.id));
  const headerCheckedState: boolean | "indeterminate" = allSelected
    ? true
    : someSelected
      ? "indeterminate"
      : false;

  const handleHeaderToggle = () => {
    if (!showSelectionColumn) return;
    onToggleAllVisible!(
      selectableRows.map((row) => row.id),
      !allSelected,
    );
  };

  const desktopColumnCount = showSelectionColumn ? 8 : 7;

  return (
    <div className="space-y-4">
      {/* Desktop table view */}
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {showSelectionColumn ? (
                <TableHead className="w-[44px]">
                  <Checkbox
                    aria-label="Seleccionar todos los clusters visibles"
                    checked={headerCheckedState}
                    disabled={selectableRows.length === 0}
                    onCheckedChange={handleHeaderToggle}
                  />
                </TableHead>
              ) : null}
              <TableHead className="min-w-[220px]">Cluster</TableHead>
              <TableHead className="min-w-[180px]">Tema</TableHead>
              <TableHead className="min-w-[140px]">Estado</TableHead>
              <TableHead className="min-w-[90px]">Ítems</TableHead>
              <TableHead className="min-w-[120px]">Prioridad</TableHead>
              <TableHead className="min-w-[140px]">Actualizado</TableHead>
              <TableHead className="w-[60px] text-right">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton showSelectionColumn={showSelectionColumn} />
            ) : isEmpty ? (
              <TableRow>
                <TableCell colSpan={desktopColumnCount} className="h-32 p-0">
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No hay clusters que coincidan con los filtros.
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const selectable = isRowSelectable(row);
                const isSelected = Boolean(selectedIds?.has(row.id));
                return (
                  <TableRow
                    key={row.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Abrir detalle del cluster ${row.title}`}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => onOpenDetail(row)}
                    onKeyDown={(event) =>
                      handleRowKeyDown(event, row, onOpenDetail)
                    }
                  >
                    {showSelectionColumn ? (
                      <TableCell
                        className="w-[44px]"
                        onClick={stopPropagation}
                        onKeyDown={stopPropagation}
                      >
                        {selectable ? (
                          <Checkbox
                            aria-label={`Seleccionar cluster ${row.title}`}
                            checked={isSelected}
                            onCheckedChange={() => onToggleRow!(row.id)}
                          />
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              {/* Span wrapper needed — disabled radix Checkbox
                                  swallows pointer events so the tooltip trigger
                                  needs a focusable fallback. */}
                              <span className="inline-flex">
                                <Checkbox
                                  aria-label={`Seleccionar cluster ${row.title}`}
                                  checked={isSelected}
                                  disabled
                                />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {DISABLED_SELECTION_TOOLTIP}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell>
                      <span className="font-medium">{row.title}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {row.topicTitle}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ClusterStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <span className="text-sm tabular-nums">
                        {row.itemCount}
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.suggestedPriority ? (
                        <span className="text-sm capitalize">
                          {row.suggestedPriority}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          -
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {formatShort(row.updatedAt)}
                      </span>
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={stopPropagation}
                      onKeyDown={stopPropagation}
                    >
                      {renderActions ? renderActions(row) : null}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card view */}
      <div className="md:hidden">
        {isLoading ? (
          <CardSkeleton />
        ) : isEmpty ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No hay clusters que coincidan con los filtros.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const selectable = isRowSelectable(row);
              const isSelected = Boolean(selectedIds?.has(row.id));
              return (
                <Card
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir detalle del cluster ${row.title}`}
                  className="cursor-pointer py-4 gap-3 active:bg-muted/50"
                  onClick={() => onOpenDetail(row)}
                  onKeyDown={(event) =>
                    handleRowKeyDown(event, row, onOpenDetail)
                  }
                >
                  <CardContent className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <div className="font-medium break-words">
                          {row.title}
                        </div>
                        <div className="text-sm text-muted-foreground break-words">
                          {row.topicTitle}
                        </div>
                      </div>
                      <div className="flex items-start gap-2 shrink-0">
                        {showSelectionColumn ? (
                          <div
                            onClick={stopPropagation}
                            onKeyDown={stopPropagation}
                          >
                            {selectable ? (
                              <Checkbox
                                aria-label={`Seleccionar cluster ${row.title}`}
                                checked={isSelected}
                                onCheckedChange={() => onToggleRow!(row.id)}
                              />
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex">
                                    <Checkbox
                                      aria-label={`Seleccionar cluster ${row.title}`}
                                      checked={isSelected}
                                      disabled
                                    />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {DISABLED_SELECTION_TOOLTIP}
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        ) : null}
                        {renderActions ? (
                          <div
                            onClick={stopPropagation}
                            onKeyDown={stopPropagation}
                          >
                            {renderActions(row)}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <ClusterStatusBadge status={row.status} />
                      <span className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground tabular-nums">
                          {row.itemCount}
                        </span>{" "}
                        ítems
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">
                          Prioridad:
                        </span>
                        {row.suggestedPriority ? (
                          <span className="capitalize">
                            {row.suggestedPriority}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>
                      <span className="text-muted-foreground">
                        {formatShort(row.updatedAt)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
