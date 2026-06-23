"use client";

import { usePendingQuestionsCount } from "../../application/hooks/use-pending-questions";

export const PendingQuestionsContainer: React.FC = () => {
  const { data: count } = usePendingQuestionsCount();

  if (!count || count === 0) return null;

  return (
    <span className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold">
      {count}
    </span>
  );
};
