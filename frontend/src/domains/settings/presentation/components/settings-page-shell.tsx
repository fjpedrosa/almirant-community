import type { ReactNode } from "react";

interface SettingsPageShellProps {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export const SettingsPageShell: React.FC<SettingsPageShellProps> = ({
  title,
  description,
  actions,
  children,
}) => (
  <div className="px-4 py-5 sm:p-6 space-y-6">
    {(title || description || actions) && (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          {title && (
            <h2 className="flex items-center gap-2 text-xl sm:text-2xl font-semibold tracking-tight">
              {title}
            </h2>
          )}
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
    )}
    {children}
  </div>
);
