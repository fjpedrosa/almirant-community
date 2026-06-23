"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import type { TagCardProps } from "@/domains/tags/domain/types";

export const TagCard: React.FC<TagCardProps> = ({ tag, onDelete }) => {
  const t = useTranslations("tags");
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div
            className="w-4 h-4 rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          <div>
            <p className="font-medium">{tag.name}</p>
            <p className="text-sm text-muted-foreground">
              {tag.leadCount} {t("leads")}
            </p>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("delete.confirm")}>
              <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("delete.title", { name: tag.name })}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("delete.description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("delete.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => onDelete(tag.id, tag.name)}
              >
                {t("delete.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};
