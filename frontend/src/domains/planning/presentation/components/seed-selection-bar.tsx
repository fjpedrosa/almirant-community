import { CheckSquare, Sprout, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SeedSelectionBarProps } from "../../domain/types";

export const SeedSelectionBar: React.FC<SeedSelectionBarProps> = ({
  selectedCount,
  totalCount,
  onSelectAll,
  onDeselectAll,
  onBulkAction,
}) => {
  if (selectedCount === 0) return null;

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-2"
      role="toolbar"
      aria-label="Acciones en lote para seeds seleccionadas"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">
          {selectedCount} de {totalCount} seleccionada
          {selectedCount !== 1 ? "s" : ""}
        </span>

        {selectedCount < totalCount && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onSelectAll}
          >
            <CheckSquare className="mr-1 h-3.5 w-3.5" />
            Seleccionar todas
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onDeselectAll}
        >
          <Square className="mr-1 h-3.5 w-3.5" />
          Deseleccionar
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onBulkAction("select_for_planning")}
        >
          <Sprout className="mr-1 h-3.5 w-3.5 text-emerald-500" />
          Incluir en planning
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onBulkAction("deselect_from_planning")}
        >
          <X className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
          Excluir de planning
        </Button>
      </div>
    </div>
  );
};
