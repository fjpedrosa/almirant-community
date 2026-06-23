"use client";

import type { SlidingFormPanelProps } from "../../domain/types";

export const SlidingFormPanel: React.FC<SlidingFormPanelProps> = ({
  activePanel,
  mainContent,
  parentContent,
}) => {
  return (
    <div className="relative overflow-hidden w-full">
      <div
        className="flex transition-transform duration-300 ease-in-out"
        style={{
          transform: activePanel === "main" ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        {/* Main form - takes full width */}
        <div
          className="w-full flex-shrink-0"
          inert={activePanel !== "main" ? true : undefined}
        >
          {mainContent}
        </div>
        {/* Parent form - takes full width */}
        <div
          className="w-full flex-shrink-0"
          inert={activePanel !== "parent" ? true : undefined}
        >
          {parentContent}
        </div>
      </div>
    </div>
  );
};
