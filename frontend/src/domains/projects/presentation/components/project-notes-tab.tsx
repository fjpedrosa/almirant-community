"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, FileText, Trash2, Save } from "lucide-react";
import type { ProjectNotesTabProps } from "../../domain/types";

export const ProjectNotesTab: React.FC<ProjectNotesTabProps> = ({
  notes,
  selectedNoteId,
  noteContent,
  newNoteTitle,
  selectedNote,
  onSelectNote,
  onNoteContentChange,
  onNewNoteTitleChange,
  onAddNote,
  onSaveNote,
  onDeleteNote,
  isCreating,
  isSaving,
}) => {
  const t = useTranslations("projects.notesTab");

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[400px]">
      {/* Notes list */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Input
            placeholder={t("newNotePlaceholder")}
            value={newNoteTitle}
            onChange={(e) => onNewNoteTitleChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onAddNote()}
          />
          <Button size="sm" onClick={onAddNote} disabled={isCreating}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {notes.map((note) => (
          <div
            key={note.id}
            className={cn(
              "flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors",
              selectedNoteId === note.id ? "bg-primary/10 border border-primary/20" : "bg-muted/50 hover:bg-muted"
            )}
            onClick={() => onSelectNote(note.id, note.content || "")}
          >
            <span className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {note.title}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteNote(note.id);
              }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
      {/* Note editor */}
      <div className="md:col-span-2">
        {selectedNoteId ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">{selectedNote?.title}</h4>
              <Button size="sm" onClick={onSaveNote} disabled={isSaving}>
                <Save className="h-4 w-4 mr-1" />
                {t("save")}
              </Button>
            </div>
            <Textarea
              value={noteContent}
              onChange={(e) => onNoteContentChange(e.target.value)}
              placeholder={t("contentPlaceholder")}
              className="min-h-[350px] font-mono text-sm"
            />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {t("selectNote")}
          </div>
        )}
      </div>
    </div>
  );
};
