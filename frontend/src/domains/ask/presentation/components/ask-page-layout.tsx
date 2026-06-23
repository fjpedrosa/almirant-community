// ---------------------------------------------------------------------------
// Component: AskPageLayout
// ---------------------------------------------------------------------------
// Chat-style layout structure for the Ask page.
// header: project selector + badges (pinned top)
// children: scrollable messages area
// footer: pinned input at bottom
// ---------------------------------------------------------------------------

export interface AskPageLayoutProps {
  header: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const AskPageLayout: React.FC<AskPageLayoutProps> = ({
  header,
  children,
  footer,
}) => {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header — pinned top */}
      <div className="shrink-0 border-b border-border px-4 py-3 md:px-6">
        <div className="mx-auto max-w-3xl">{header}</div>
      </div>

      {/* Messages area — scrollable */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col">
        {children}
      </div>

      {/* Footer — pinned bottom (input) */}
      {footer && (
        <div className="shrink-0 border-t border-border bg-background">
          {footer}
        </div>
      )}
    </div>
  );
};
