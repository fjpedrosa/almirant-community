import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { LocaleSelectorProps } from "../../domain/types";

export const LocaleSelector: React.FC<LocaleSelectorProps> = ({
  currentLocale,
  locales,
  isUpdating,
  onLocaleChange,
}) => {
  const currentOption = locales.find((l) => l.value === currentLocale);
  const t = useTranslations("settings.language");

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">{t("title")}</h3>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <Select
        value={currentLocale}
        onValueChange={onLocaleChange}
        disabled={isUpdating}
      >
        <SelectTrigger className="w-[280px]">
          {isUpdating ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t("updating")}</span>
            </div>
          ) : (
            <SelectValue>
              {currentOption && (
                <span>
                  {currentOption.flag} {currentOption.label}
                </span>
              )}
            </SelectValue>
          )}
        </SelectTrigger>
        <SelectContent>
          {locales.map((locale) => (
            <SelectItem key={locale.value} value={locale.value}>
              <span className="flex items-center gap-2">
                <span>{locale.flag}</span>
                <span>{locale.label}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
