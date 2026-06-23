import { BookOpen, ChevronDown, ChevronUp, ChevronsUp, Crown, Equal, Lightbulb, Puzzle, SquareCheckBig } from "lucide-react";
import type { Priority, TShirtSize, WorkItemType } from "../../domain/types";

export const typeBadgeColors: Record<WorkItemType, string> = {
  epic: "bg-purple-600 text-white border-purple-600 rounded-sm",
  feature: "bg-blue-600 text-white border-blue-600 rounded-sm",
  story: "bg-green-600 text-white border-green-600 rounded-sm",
  task: "bg-slate-600 text-white border-slate-600 rounded-sm",
  idea: "bg-amber-500 text-white border-amber-500 rounded-sm",
};

export const priorityColors: Record<Priority, string> = {
  urgent: "text-red-500",
  high: "text-orange-500",
  medium: "text-yellow-500",
  low: "text-blue-400",
};

export const priorityIcons: Record<Priority, React.ElementType> = {
  urgent: ChevronsUp,
  high: ChevronUp,
  medium: Equal,
  low: ChevronDown,
};

export const typeIcons: Record<WorkItemType, React.ElementType> = {
  epic: Crown,
  feature: Puzzle,
  story: BookOpen,
  task: SquareCheckBig,
  idea: Lightbulb,
};

export const typeColors: Record<WorkItemType, string> = {
  epic: "text-purple-500",
  feature: "text-blue-500",
  story: "text-green-500",
  task: "text-slate-500",
  idea: "text-amber-500",
};

export const tshirtSizeColors: Record<TShirtSize, string> = {
  XS: "text-sky-500",
  S: "text-cyan-500",
  M: "text-slate-500",
  L: "text-amber-500",
  XL: "text-orange-500",
  XXL: "text-red-500",
};
