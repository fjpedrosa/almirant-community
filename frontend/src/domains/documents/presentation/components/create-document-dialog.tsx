"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DynamicIcon, hasIcon } from "@/lib/icon-map";
import type { CreateDocumentDialogProps, DocumentCategoryWithCount } from "../../domain/types";

const flattenCategoriesDepthFirst = (
  categories: DocumentCategoryWithCount[]
): Array<{ category: DocumentCategoryWithCount; depth: number }> => {
  const byParent = new Map<string | null, DocumentCategoryWithCount[]>();
  for (const cat of categories) {
    const key = cat.parentId;
    const list = byParent.get(key) ?? [];
    list.push(cat);
    byParent.set(key, list);
  }

  const result: Array<{ category: DocumentCategoryWithCount; depth: number }> = [];

  const walk = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    const sorted = [...children].sort((a, b) => a.order - b.order);
    for (const cat of sorted) {
      result.push({ category: cat, depth });
      walk(cat.id, depth + 1);
    }
  };

  walk(null, 0);
  return result;
};

export const CreateDocumentDialog: React.FC<CreateDocumentDialogProps> = ({
  open,
  onOpenChange,
  categories,
  projects,
  onSubmit,
  isPending,
}) => {
  const t = useTranslations("documents");
  const tCommon = useTranslations("common");
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("__none__");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      categoryId: categoryId || undefined,
      projectId: projectId === "__none__" ? undefined : projectId,
    });
    setTitle("");
    setCategoryId("");
    setProjectId("__none__");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("createDocument")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doc-title">{t("form.title")}</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("form.titlePlaceholder")}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-category">{t("form.category")}</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="doc-category">
                <SelectValue placeholder={t("form.selectCategory")} />
              </SelectTrigger>
              <SelectContent>
                {flattenCategoriesDepthFirst(
                  categories.filter((c) => c.status === "active")
                ).map(({ category: cat, depth }) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span
                      className="flex items-center gap-2"
                      style={{ paddingLeft: `${depth * 16}px` }}
                    >
                      {hasIcon(cat.icon) ? (
                        <DynamicIcon name={cat.icon} className="w-3 h-3" style={{ color: cat.color }} />
                      ) : (
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: cat.color }}
                        />
                      )}
                      {cat.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-project">{t("form.project")}</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger id="doc-project">
                <SelectValue placeholder={t("form.selectProject")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">
                    {t("form.noProject")}
                  </span>
                </SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: project.color }}
                      />
                      {project.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={!title.trim() || isPending}>
              {isPending ? tCommon("creating") : tCommon("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
