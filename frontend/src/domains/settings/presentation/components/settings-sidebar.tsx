import Link from "next/link";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { SettingsSidebarProps } from "../../domain/types";

export const SettingsSidebar: React.FC<SettingsSidebarProps> = ({
  groups,
  activeSection,
  title,
  subtitle,
  betaLabel,
}) => {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-6 pb-4">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      <ScrollArea className="flex-1 px-2 pb-4">
        <nav aria-label={title}>
          {groups.map((group, groupIndex) => (
            <div key={group.id} className={cn(groupIndex > 0 && "mt-4")}>
              <h2 className="px-3 mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {group.label}
              </h2>
              <ul className="space-y-0.5">
                {group.sections.map((section) => {
                  const isActive = activeSection === section.id;
                  const Icon = section.icon;
                  return (
                    <li key={section.id}>
                      <Link
                        href={section.href}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                          isActive
                            ? "bg-accent text-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                        )}
                        aria-current={isActive ? "page" : undefined}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{section.name}</span>
                        {section.isBeta && (
                          <Badge
                            variant="outline"
                            className="ml-auto h-4 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide bg-primary/10 border-primary/30 text-primary"
                          >
                            {betaLabel}
                          </Badge>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </ScrollArea>
    </div>
  );
};
