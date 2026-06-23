import { MoreHorizontal, Pencil, Trash2, Eye, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SkillSourceBadge } from "./skill-source-badge";
import type { SkillsListProps, Skill } from "../../domain/types";

const SKELETON_ROWS = 5;
const COLUMN_COUNT = 7;

const SkeletonRow = () => (
  <TableRow>
    {Array.from({ length: COLUMN_COUNT }).map((_, i) => (
      <TableCell key={i}>
        <Skeleton className="h-4 w-full" />
      </TableCell>
    ))}
  </TableRow>
);

const formatDate = (dateString: string): string => {
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "Unknown";
  }
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return `${size.toFixed(size < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

interface SkillRowProps {
  skill: Skill;
  onEdit: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
  onViewDetail: (skill: Skill) => void;
}

const SkillRow = ({ skill, onEdit, onDelete, onViewDetail }: SkillRowProps) => {
  const isOfficial = skill.source === "official";

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => onViewDetail(skill)}
    >
      <TableCell>
        <div className="flex items-center gap-1.5">
          {isOfficial && (
            <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          )}
          <span className="font-medium">{skill.name}</span>
        </div>
        <div className="text-xs text-muted-foreground">{skill.slug}</div>
      </TableCell>
      <TableCell>
        <SkillSourceBadge source={skill.source} />
      </TableCell>
      <TableCell>
        <span className="text-sm text-muted-foreground line-clamp-2 max-w-xs">
          {skill.description || "-"}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{`v${skill.version}`}</Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatFileSize(skill.sizeBytes)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatDate(skill.updatedAt)}
      </TableCell>
      <TableCell className="w-12">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onViewDetail(skill);
              }}
            >
              <Eye className="h-4 w-4 mr-2" />
              View
            </DropdownMenuItem>
            {!isOfficial && (
              <>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(skill);
                  }}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(skill);
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
};

export const SkillsList = ({
  skills,
  isLoading,
  onEdit,
  onDelete,
  onViewDetail,
}: SkillsListProps) => {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <SkeletonRow key={i} />
            ))
          ) : skills.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={COLUMN_COUNT}
                className="h-32 text-center text-muted-foreground"
              >
                No skills found. Create one to get started.
              </TableCell>
            </TableRow>
          ) : (
            skills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                onEdit={onEdit}
                onDelete={onDelete}
                onViewDetail={onViewDetail}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};
