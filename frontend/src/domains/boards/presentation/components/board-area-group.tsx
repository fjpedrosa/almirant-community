import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { BoardCard } from "./board-card";
import type { BoardAreaGroupProps } from "../../domain/types";

export const BoardAreaGroup: React.FC<BoardAreaGroupProps> = ({
  areaLabel,
  boards,
}) => {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
        <LayoutGrid className="h-5 w-5 text-muted-foreground" />
        {areaLabel}
        <span className="text-sm text-muted-foreground font-normal">
          ({boards.length})
        </span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {boards.map((board) => (
          <Link
            key={board.id}
            href={`/board/${board.area}`}
            prefetch={true}
            className="block"
          >
            <BoardCard board={board} />
          </Link>
        ))}
      </div>
    </div>
  );
};
