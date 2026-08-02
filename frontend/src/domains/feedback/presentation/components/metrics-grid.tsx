import type { ReactNode } from "react";

export interface MetricsGridProps {
  children: ReactNode;
}

export const MetricsGrid: React.FC<MetricsGridProps> = ({ children }) => {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {children}
    </div>
  );
};
