import type { SessionSidebarGroupProps } from "../../domain/types";

export const SessionSidebarGroup: React.FC<SessionSidebarGroupProps> = ({
  label,
  children,
}) => {
  return (
    <div className="mb-2">
      <h3 className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
};
