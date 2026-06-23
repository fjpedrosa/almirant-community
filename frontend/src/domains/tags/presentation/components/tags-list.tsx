"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus } from "lucide-react";
import { TagCard } from "@/domains/tags/presentation/components/tag-card";
import type { TagsListProps } from "@/domains/tags/domain/types";

export const TagsList: React.FC<TagsListProps> = ({
  tags,
  isLoading,
  onDelete,
  onCreateClick,
}) => {
  const t = useTranslations("tags");
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (!tags || tags.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground mb-4">{t("empty")}</p>
          <Button onClick={onCreateClick}>
            <Plus className="h-4 w-4 mr-2" />
            {t("createFirst")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {tags.map((tag) => (
        <TagCard key={tag.id} tag={tag} onDelete={onDelete} />
      ))}
    </div>
  );
};
