import { useTranslations } from "next-intl";
import { Sun, Moon, Monitor } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ThemeSelectorProps, ThemeOption } from "../../domain/types";

const themeOptions: { value: ThemeOption; icon: typeof Sun }[] = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
];

const ThemePreview: React.FC<{ theme: ThemeOption }> = ({ theme }) => {
  const isDark = theme === "dark";
  const isSystem = theme === "system";

  const bg = isDark ? "bg-zinc-900" : isSystem ? "bg-gradient-to-r from-white to-zinc-900" : "bg-white";
  const sidebarBg = isDark ? "bg-zinc-800" : isSystem ? "bg-zinc-300" : "bg-zinc-100";
  const lineBg = isDark ? "bg-zinc-700" : isSystem ? "bg-zinc-400" : "bg-zinc-200";
  const accentBg = isDark ? "bg-blue-500" : isSystem ? "bg-blue-500" : "bg-blue-500";

  return (
    <div
      className={`w-full aspect-[16/9] rounded border border-border/50 overflow-hidden ${bg}`}
    >
      <div className="flex h-full">
        <div className={`w-1/4 h-full ${sidebarBg} p-1 flex flex-col gap-0.5`}>
          <div className={`h-1 w-full rounded-sm ${accentBg}`} />
          <div className={`h-1 w-3/4 rounded-sm ${lineBg}`} />
          <div className={`h-1 w-3/4 rounded-sm ${lineBg}`} />
        </div>
        <div className="flex-1 p-1 flex flex-col gap-0.5">
          <div className={`h-1.5 w-1/2 rounded-sm ${lineBg}`} />
          <div className={`h-1 w-3/4 rounded-sm ${lineBg} opacity-60`} />
          <div className={`h-1 w-2/3 rounded-sm ${lineBg} opacity-40`} />
        </div>
      </div>
    </div>
  );
};

export const ThemeSelector: React.FC<ThemeSelectorProps> = ({
  currentTheme,
  mounted,
  onThemeChange,
}) => {
  const t = useTranslations("settings.appearance");

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{t("title")}</h3>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {themeOptions.map(({ value, icon: Icon }) => {
          const isActive = currentTheme === value;
          const labelKey = value as "light" | "dark" | "system";
          const descKey = `${value}Desc` as "lightDesc" | "darkDesc" | "systemDesc";

          return mounted ? (
            <button
              key={value}
              type="button"
              onClick={() => onThemeChange(value)}
              className={`flex flex-col items-center gap-1.5 rounded-lg border-2 p-2 sm:p-3 transition-all cursor-pointer ${
                isActive
                  ? "border-primary ring-2 ring-primary/20 bg-accent"
                  : "border-border hover:border-muted-foreground/30"
              }`}
            >
              <ThemePreview theme={value} />
              <div className="flex items-center gap-1.5 mt-0.5">
                <Icon className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                <span className={`text-sm font-medium ${isActive ? "text-primary" : "text-foreground"}`}>
                  {t(labelKey)}
                </span>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground text-center">{t(descKey)}</p>
            </button>
          ) : (
            <Skeleton key={value} className="h-36 rounded-lg" />
          );
        })}
      </div>
    </div>
  );
};
