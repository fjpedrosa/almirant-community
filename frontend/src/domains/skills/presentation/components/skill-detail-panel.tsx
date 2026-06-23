import { useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { MarkdownPreview } from "@/domains/shared/presentation/components/markdown-preview";
import { SkillSourceBadge } from "./skill-source-badge";
import type { SkillDetailPanelProps } from "../../domain/types";

const formatDate = (dateString: string): string => {
  try {
    return new Date(dateString).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Unknown";
  }
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

/** Strip YAML frontmatter (---...---) from skill content since name/description are shown in the header. */
const stripFrontmatter = (content: string): string => {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return match ? content.slice(match[0].length) : content;
};

export const SkillDetailPanel = ({
  skill,
  open,
  onOpenChange,
}: SkillDetailPanelProps) => {
  const body = useMemo(
    () => (skill ? stripFrontmatter(skill.content) : ""),
    [skill],
  );

  if (!skill) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-2xl w-full flex flex-col">
        <SheetHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-lg">{skill.name}</SheetTitle>
            <SkillSourceBadge source={skill.source} />
          </div>
          {skill.description && (
            <SheetDescription>{skill.description}</SheetDescription>
          )}
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground pt-1">
            <span>Version: {skill.version}</span>
            <span>Size: {formatBytes(skill.sizeBytes)}</span>
            <span>Updated: {formatDate(skill.updatedAt)}</span>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 pb-6">
            <MarkdownPreview content={body} />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
