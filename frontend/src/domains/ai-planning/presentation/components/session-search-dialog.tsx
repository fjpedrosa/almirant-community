import { useTranslations } from "next-intl";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import type { SessionSearchDialogProps } from "../../domain/types";

export const SessionSearchDialog: React.FC<SessionSearchDialogProps> = ({
  isOpen,
  onOpenChange,
  groups,
  onSessionClick,
}) => {
  const t = useTranslations("aiPlanning.sidebar");

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={t("search")}
      description={t("searchPlaceholder")}
      className="sm:max-w-xl"
      showCloseButton={false}
    >
      <CommandInput placeholder={t("searchPlaceholder")} />
      <CommandList className="max-h-[400px]">
        <CommandEmpty>{t("noResults")}</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.sessions.map((session) => (
              <CommandItem
                key={session.id}
                onSelect={() => {
                  onSessionClick(session.id);
                  onOpenChange(false);
                }}
                className="flex items-start gap-2 py-2.5"
              >
                {session.status === "active" && (
                  <span className="size-2 shrink-0 rounded-full bg-green-500 mt-1.5" />
                )}
                <div className="flex flex-col min-w-0">
                  <span className="truncate text-sm">{session.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {session.relativeDate}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
};
