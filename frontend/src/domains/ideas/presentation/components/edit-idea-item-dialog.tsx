"use client";

import { useEffect } from "react";
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
import type { EditIdeaItemDialogProps, IdeaItemStatus } from "../../domain/types";
import { getStatusLabels } from "./idea-inline-status";

const IDEA_STATUSES: IdeaItemStatus[] = ["draft", "active", "to_review", "approved", "archived", "rejected"];

export const EditIdeaItemDialog: React.FC<EditIdeaItemDialogProps> = ({
  open,
  onOpenChange,
  form,
  projects,
  owners,
  isPending,
  onSubmit,
}) => {
  const t = useTranslations("ideas");
  const STATUS_LABELS = getStatusLabels(t);
  const { register, watch, setValue } = form;
  const status = watch("status");
  const dueDate = watch("dueDate");
  const statusOptions = IDEA_STATUSES;

  useEffect(() => {
    if (status && !statusOptions.includes(status)) {
      setValue("status", statusOptions[0]);
    }
  }, [setValue, status, statusOptions]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t("editDialog.title")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("editDialog.status")}</Label>
              <Select
                value={status}
                onValueChange={(value) => setValue("status", value as IdeaItemStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {STATUS_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("editDialog.project")}</Label>
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
          </div>

          <div className="space-y-2">
            <Label>{t("editDialog.titleField")}</Label>
            <Input {...register("title")} />
          </div>

          <div className="space-y-2">
            <Label>{t("editDialog.description")}</Label>
            <Textarea {...register("description")} rows={4} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("editDialog.owner")}</Label>
              <Select
                value={watch("ownerUserId")}
                onValueChange={(value) => setValue("ownerUserId", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("editDialog.noOwner")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("editDialog.noOwner")}</SelectItem>
                  {owners.map((owner) => (
                    <SelectItem key={owner.id} value={owner.id}>
                      {owner.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("editDialog.dueDate")}</Label>
              <Input
                type="date"
                value={dueDate ?? ""}
                onChange={(event) => setValue("dueDate", event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              {t("editDialog.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? t("editDialog.saving") : t("editDialog.saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
