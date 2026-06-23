"use client";

import {
  CalendarDays,
  Check,
  CheckSquare,
  ChevronsUpDown,
  FolderOpen,
  SignalHigh,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import useFormattedDate from "@/domains/shared/application/hooks/use-formatted-date";
import { OwnerAvatarPicker } from "@/domains/shared/presentation/components/owner-avatar-picker";
import type { CreateTodoDialogProps, TodoItemPriority } from "../../domain/types";
import {
  TODO_PRIORITY_COLORS,
} from "./todo-priority-badge";

const PRIORITY_OPTIONS: TodoItemPriority[] = ["low", "medium", "high", "urgent"];

const PRIORITY_ICONS: Record<TodoItemPriority, string> = {
  low: "bg-slate-400",
  medium: "bg-blue-500",
  high: "bg-orange-500",
  urgent: "bg-red-500",
};

export const CreateTodoDialog: React.FC<CreateTodoDialogProps> = ({
  open,
  onOpenChange,
  form,
  projects,
  owners,
  isPending,
  onSubmit,
}) => {
  const t = useTranslations("todos");
  const { formatShort, locale } = useFormattedDate();

  const { register, watch, setValue } = form;
  const projectId = watch("projectId");
  const ownerUserId = watch("ownerUserId");
  const priority = watch("priority");
  const dueDate = watch("dueDate");

  const selectedProject = projects.find((p) => p.id === projectId);

  const parsedDate = dueDate ? new Date(dueDate + "T00:00:00") : undefined;

  const getPriorityLabel = (p: TodoItemPriority) => t(`priority.${p}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto p-0 sm:max-w-[540px] gap-0">
        {/* Header area with icon */}
        <div className="flex items-center gap-2 px-6 pt-5 pb-1">
          <CheckSquare className="h-4 w-4 text-muted-foreground/60" />
          <span className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wide">
            {t("newTodo")}
          </span>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="px-6 pb-3"
        >
          {/* Title - prominent borderless input */}
          <input
            {...register("title")}
            placeholder={t("form.titlePlaceholder")}
            autoFocus
            className="w-full text-lg font-medium placeholder:text-muted-foreground/40 border-none outline-none focus:ring-0 bg-transparent py-2"
          />

          {/* Description - borderless textarea */}
          <textarea
            {...register("description")}
            rows={2}
            placeholder={t("form.descriptionPlaceholder")}
            className="w-full text-sm text-muted-foreground placeholder:text-muted-foreground/40 border-none outline-none focus:ring-0 bg-transparent resize-none py-1"
          />

          {/* Metadata chips row */}
          <div className="flex flex-wrap items-center gap-1.5 pt-3 pb-1">
            {/* Project chip */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border-0 cursor-pointer",
                    selectedProject
                      ? "bg-primary/10 text-primary hover:bg-primary/15"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted",
                  )}
                >
                  <FolderOpen className="h-3 w-3" />
                  {selectedProject?.name ?? t("form.project")}
                  <ChevronsUpDown className="h-3 w-3 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-0" align="start">
                <Command>
                  <CommandInput placeholder={t("dialog.searchProject")} />
                  <CommandList>
                    <CommandEmpty>{t("dialog.noResults")}</CommandEmpty>
                    <CommandGroup>
                      {projects.map((project) => (
                        <CommandItem
                          key={project.id}
                          value={project.name}
                          onSelect={() => setValue("projectId", project.id)}
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                          {project.name}
                          {project.id === projectId && (
                            <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                          )}
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

            {/* Priority chip */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border-0 cursor-pointer",
                    priority
                      ? TODO_PRIORITY_COLORS[priority]
                      : "bg-muted/50 text-muted-foreground hover:bg-muted",
                  )}
                >
                  <SignalHigh className="h-3 w-3" />
                  {priority ? getPriorityLabel(priority) : t("form.priority")}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-40 p-1" align="start">
                {PRIORITY_OPTIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent",
                      p === priority && "bg-accent/50",
                    )}
                    onClick={() => setValue("priority", p)}
                  >
                    <span
                      className={cn(
                        "inline-flex h-2 w-2 rounded-full",
                        PRIORITY_ICONS[p],
                      )}
                    />
                    {getPriorityLabel(p)}
                    {p === priority && (
                      <Check className="ml-auto h-3.5 w-3.5 text-primary" />
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

            {/* Date chip */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors border-0 cursor-pointer",
                    dueDate
                      ? "bg-primary/10 text-primary hover:bg-primary/15"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted",
                  )}
                >
                  <CalendarDays className="h-3 w-3" />
                  {parsedDate
                    ? formatShort(parsedDate)
                    : t("form.date")}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={parsedDate}
                  onSelect={(date) => {
                    if (date) {
                      const yyyy = date.getFullYear();
                      const mm = String(date.getMonth() + 1).padStart(2, "0");
                      const dd = String(date.getDate()).padStart(2, "0");
                      setValue("dueDate", `${yyyy}-${mm}-${dd}`);
                    }
                  }}
                  locale={locale}
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
            {t("form.cancel")}
          </Button>
          <Button
            size="sm"
            disabled={isPending}
            onClick={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {isPending ? t("creating") : t("createTodo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
