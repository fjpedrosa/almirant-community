import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SettingsSidebar } from "./settings-sidebar";
import type { SettingsLayoutProps } from "../../domain/types";

export const SettingsLayout: React.FC<SettingsLayoutProps> = ({
  groups,
  activeSection,
  title,
  subtitle,
  betaLabel,
  children,
}) => {
  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-[260px] md:shrink-0 border-r bg-muted/30">
        <SettingsSidebar
          groups={groups}
          activeSection={activeSection}
          title={title}
          subtitle={subtitle}
          betaLabel={betaLabel}
        />
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header with menu trigger */}
        <div className="flex items-center gap-3 border-b px-4 py-3 md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Open settings menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] p-0">
              <SheetTitle className="sr-only">{title}</SheetTitle>
              <SettingsSidebar
                groups={groups}
                activeSection={activeSection}
                title={title}
                subtitle={subtitle}
                betaLabel={betaLabel}
              />
            </SheetContent>
          </Sheet>
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1200px]">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};
