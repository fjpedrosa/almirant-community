"use client";

import { Check, FolderOpen, Sprout } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { OwnerAvatarPicker } from "@/domains/shared/presentation/components/owner-avatar-picker";
import type { CreateSeedDialogProps } from "../../domain/types";

const SOURCE_OPTIONS = [
  { value: "manual", labelKey: "sourceManual" },
  { value: "feedback", labelKey: "sourceFeedback" },
  { value: "ai_generated", labelKey: "sourceAi" },
  { value: "import", labelKey: "sourceImport" },
] as const;

const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const;

export const CreateSeedDialog: React.FC<CreateSeedDialogProps> = ({
  open,
  onOpenChange,
  form,
  projects,
  owners,
  isPending,
  onSubmit,
}) => {
  const t = useTranslations("seeds.createDialog");
  const tPriorities = useTranslations("priorities");
  const { register, watch, setValue } = form;
  const projectId = watch("projectId");
  const ownerUserId = watch("ownerUserId");
  const source = watch("source");
  const priority = watch("priority");

  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-t-4 border-t-emerald-500 p-0 sm:max-w-[540px]">
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="flex items-center gap-2">
            <Sprout className="h-5 w-5 text-emerald-500" />
            {t("title")}
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
            placeholder={t("titlePlaceholder")}
            autoFocus
          />

          {/* Description - borderless textarea */}
          <textarea
            {...register("description")}
            rows={2}
            className="mt-1 w-full resize-none border-0 bg-transparent text-sm text-muted-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            placeholder={t("descriptionPlaceholder")}
          />

          {/* Metadata chips row */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
            {/* Project chip */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border-0 px-3 py-1 text-xs font-medium transition-colors",
                    selectedProject
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted",
                  )}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  {selectedProject?.name ?? t("project")}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-0" align="start">
                <Command>
                  <CommandInput placeholder={t("searchProject")} />
                  <CommandList>
                    <CommandEmpty>{t("noResults")}</CommandEmpty>
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

            {/* Source chip */}
            <Select
              value={source}
              onValueChange={(value) =>
                setValue(
                  "source",
                  value as "manual" | "feedback" | "ai_generated" | "import",
                )
              }
            >
              <SelectTrigger className="h-auto w-auto gap-1.5 rounded-full border-0 bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted">
                <SelectValue placeholder={t("source")} />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Priority chip */}
            <Select
              value={priority || ""}
              onValueChange={(value) => setValue("priority", value)}
            >
              <SelectTrigger
                className={cn(
                  "h-auto w-auto gap-1.5 rounded-full border-0 px-3 py-1 text-xs font-medium",
                  priority
                    ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted",
                )}
              >
                <SelectValue placeholder={t("priority")} />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {tPriorities(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            disabled={isPending}
            onClick={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {isPending ? t("creating") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
