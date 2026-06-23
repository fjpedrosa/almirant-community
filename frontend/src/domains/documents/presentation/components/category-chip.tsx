import { cn } from "@/lib/utils";
import { DynamicIcon, hasIcon } from "@/lib/icon-map";
import type { CategoryChipProps } from "../../domain/types";

export const CategoryChip: React.FC<CategoryChipProps> = ({
  name,
  color,
  icon,
  count,
  isActive,
  onClick,
}) => {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
        isActive
          ? "bg-primary/20 text-primary ring-1 ring-primary/30"
          : "bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {hasIcon(icon) ? (
        <DynamicIcon name={icon} className="w-3 h-3 shrink-0" style={{ color }} />
      ) : (
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
      )}
      {name}
      {count !== undefined && (
        <span className="text-muted-foreground">{count}</span>
      )}
    </button>
  );
};
