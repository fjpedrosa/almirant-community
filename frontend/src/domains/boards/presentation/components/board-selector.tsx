"use client";

import { Button } from "@/components/ui/button";
import type { BoardSelectorProps } from "../../domain/types";

export const BoardSelector: React.FC<BoardSelectorProps> = ({
  boards,
  activeBoardId,
  onBoardSelect,
}) => {
  if (boards.length <= 1) return null;

  return (
    <div className="flex gap-2">
      {boards.map((board) => (
        <Button
          key={board.id}
          variant={board.id === activeBoardId ? "default" : "outline"}
          size="sm"
          onClick={() => onBoardSelect(board.id)}
        >
          {board.name}
        </Button>
      ))}
    </div>
  );
};
