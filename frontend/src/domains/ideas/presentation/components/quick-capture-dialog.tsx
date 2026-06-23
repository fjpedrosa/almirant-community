"use client";

import { format } from "date-fns";
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import {
  CalendarDays,
  Check,
  FolderOpen,
  Lightbulb,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { OwnerAvatarPicker } from "@/domains/shared/presentation/components/owner-avatar-picker";
import type { QuickCaptureDialogProps } from "../../domain/types";

export const QuickCaptureDialog: React.FC<QuickCaptureDialogProps> = ({
  open,
  onOpenChange,
  form,
  projects,
  owners,
  isPending,
  onSubmit,
}) => {
  const t = useTranslations("ideas");
  const { formatShort, locale } = useFormattedDate();
  const { register, watch, setValue } = form;
  const projectId = watch("projectId");
  const ownerUserId = watch("ownerUserId");
  const dueDate = watch("dueDate");

  const selectedProject = projects.find((p) => p.id === projectId);
  const parsedDueDate = dueDate ? new Date(dueDate) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 sm:max-w-[540px] border-t-4 border-t-violet-500"
      >
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-amber-500" />
            {t("quickCapture.title")}
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="px-6 pb-2"
        >
          {/* Title - borderless large input */}
          <input
            {...register("title")}
            className="w-full border-0 bg-transparent text-lg font-medium placeholder:text-muted-foreground/50 focus:outline-none"
            placeholder={t("quickCapture.ideaTitlePlaceholder")}
            autoFocus
          />

          {/* Description - borderless textarea */}
          <textarea
            {...register("description")}
            rows={2}
            className="mt-1 w-full resize-none border-0 bg-transparent text-sm text-muted-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            placeholder={t("quickCapture.ideaDescPlaceholder")}
          />

          {/* Metadata chips row */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
            {/* Project chip */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border-0",
                    selectedProject
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted",
                  )}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {selectedProject?.name ?? t("quickCapture.project")}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-0" align="start">
                <Command>
                  <CommandInput placeholder={t("quickCapture.searchProject")} />
                  <CommandList>
                    <CommandEmpty>{t("quickCapture.noResults")}</CommandEmpty>
                    <CommandGroup>
                      {projects.map((project) => (
                        <CommandItem
                          key={project.id}
                          value={project.name}
                          onSelect={() => setValue("projectId", project.id)}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-3.5 w-3.5",
                              projectId === project.id
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          {project.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Owner avatar picker */}
            <OwnerAvatarPicker
              currentOwnerId={ownerUserId}
              members={owners}
              onOwnerChange={(userId) => setValue("ownerUserId", userId)}
              size="md"
            />

            {/* Due date chip */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border-0",
                    parsedDueDate
                      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted",
                  )}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  {parsedDueDate
                    ? formatShort(parsedDueDate)
                    : t("quickCapture.dueDate")}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={parsedDueDate}
                  onSelect={(date) =>
                    setValue(
                      "dueDate",
                      date ? format(date, "yyyy-MM-dd") : "",
                    )
                  }
                  locale={locale}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </form>

        <DialogFooter className="border-t bg-muted/30 px-6 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("quickCapture.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={isPending}
            onClick={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {isPending ? t("quickCapture.creating") : t("quickCapture.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
