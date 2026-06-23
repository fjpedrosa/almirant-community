"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, ExternalLink, Trash2 } from "lucide-react";
import type { ProjectDocsTabProps, DocLinkType } from "../../domain/types";

export const ProjectDocsTab: React.FC<ProjectDocsTabProps> = ({
  docLinks,
  newLinkTitle,
  newLinkUrl,
  newLinkType,
  onTitleChange,
  onUrlChange,
  onTypeChange,
  onAddLink,
  onDeleteLink,
  isAdding,
  docLinkIcons,
}) => {
  const t = useTranslations("projects.docsTab");

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">{t("title")}</h3>
      {/* Add link form */}
      <div className="flex gap-2">
        <Input
          placeholder={t("titlePlaceholder")}
          value={newLinkTitle}
          onChange={(e) => onTitleChange(e.target.value)}
          className="max-w-[200px]"
        />
        <Input
          placeholder="URL"
          value={newLinkUrl}
          onChange={(e) => onUrlChange(e.target.value)}
        />
        <Select value={newLinkType} onValueChange={(v) => onTypeChange(v as DocLinkType)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="notion">Notion</SelectItem>
            <SelectItem value="github">GitHub</SelectItem>
            <SelectItem value="gdocs">Google Docs</SelectItem>
            <SelectItem value="confluence">Confluence</SelectItem>
            <SelectItem value="figma">Figma</SelectItem>
            <SelectItem value="other">{t("other")}</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={onAddLink} disabled={isAdding}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {/* Links list */}
      <div className="space-y-2">
        {docLinks.map((link) => (
          <div
            key={link.id}
            className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
          >
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 hover:underline"
            >
              <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                {docLinkIcons[link.type]}
              </span>
              <span className="text-sm font-medium">{link.title}</span>
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </a>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDeleteLink(link.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};
