import { Badge } from "@/components/ui/badge";
import type { ExpenseCategory } from "../../domain/types";

interface Props {
  category: ExpenseCategory | null;
}

export const ExpenseCategoryBadge = ({ category }: Props) => {
  if (!category) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <Badge
      variant="outline"
      style={category.color ? { borderColor: category.color, color: category.color } : undefined}
    >
      {category.icon && <span className="mr-1">{category.icon}</span>}
      {category.name}
    </Badge>
  );
};
