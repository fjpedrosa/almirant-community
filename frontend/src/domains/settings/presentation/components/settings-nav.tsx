import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { SettingsNavProps } from "../../domain/types";

export const SettingsNav: React.FC<SettingsNavProps> = ({ sections, betaLabel }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {sections.map((section) => (
        <Link key={section.id} href={section.href}>
          <div className="bg-card border rounded-lg p-4 sm:p-6 hover:border-primary/50 transition-colors cursor-pointer">
            <div className="flex items-start justify-between mb-3">
              <section.icon className="h-8 w-8 text-primary" />
              {section.isBeta && (
                <Badge
                  variant="outline"
                  className="h-5 px-2 text-[10px] font-medium uppercase tracking-wide bg-primary/10 border-primary/30 text-primary"
                >
                  {betaLabel}
                </Badge>
              )}
            </div>
            <h3 className="font-semibold">{section.name}</h3>
            <p className="text-sm text-muted-foreground">{section.description}</p>
          </div>
        </Link>
      ))}
    </div>
  );
};
