"use client";

import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Priority } from "@/domains/work-items/domain/types";
import type { PromoteIdeaItemDialogProps } from "../../domain/types";

const PRIORITY_OPTIONS: Priority[] = ["low", "medium", "high", "urgent"];

export const PromoteIdeaItemDialog: React.FC<PromoteIdeaItemDialogProps> = ({
  open,
  onOpenChange,
  form,
  item,
  projects,
  boards,
  columns,
  isPending,
  onSubmit,
}) => {
  const t = useTranslations("ideas");
  const tPriorities = useTranslations("priorities");
  const { register, watch, setValue } = form;
  const priority = watch("priority");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpRight className="h-5 w-5 text-blue-500" />
            {t("promoteDialog.title")}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t("promoteDialog.promoting")} <span className="font-medium text-foreground">{item?.title ?? "-"}</span>
        </p>

        <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("promoteDialog.destinationType")}</Label>
              <Select
                value={watch("workItemType")}
                onValueChange={(value) =>
                  setValue("workItemType", value as "task" | "story" | "feature" | "epic")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">Task</SelectItem>
                  <SelectItem value="story">Story</SelectItem>
                  <SelectItem value="feature">Feature</SelectItem>
                  <SelectItem value="epic">Epic</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("promoteDialog.priority")}</Label>
              <Select
                value={priority}
                onValueChange={(value) => setValue("priority", value as Priority)}
              >
                <SelectTrigger>
                  <SelectValue />
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
          </div>

          <div className="space-y-2">
            <Label>{t("promoteDialog.workItemTitle")}</Label>
            <Input {...register("title")} />
          </div>

          <div className="space-y-2">
            <Label>{t("promoteDialog.description")}</Label>
            <Textarea rows={4} {...register("description")} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>{t("promoteDialog.project")}</Label>
              <Select
                value={watch("projectId")}
                onValueChange={(value) => setValue("projectId", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("promoteDialog.board")}</Label>
              <Select
                value={watch("boardId")}
                onValueChange={(value) => setValue("boardId", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {boards.map((board) => (
                    <SelectItem key={board.id} value={board.id}>
                      {board.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("promoteDialog.column")}</Label>
              <Select
                value={watch("boardColumnId")}
                onValueChange={(value) => setValue("boardColumnId", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((column) => (
                    <SelectItem key={column.id} value={column.id}>
                      {column.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("promoteDialog.notes")}</Label>
            <Textarea rows={2} {...register("notes")} placeholder={t("promoteDialog.notesPlaceholder")} />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("promoteDialog.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? t("promoteDialog.promotingAction") : t("promoteDialog.promote")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
