"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { InlineTitleProps } from "../../domain/types";

export const InlineTitle: React.FC<InlineTitleProps> = ({
  value,
  onChange,
  isLoading = false,
  placeholder,
  className,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const handleStartEdit = () => {
    setDraft(value);
    setIsEditing(true);
    requestAnimationFrame(() => {
      adjustHeight();
      textareaRef.current?.focus();
      textareaRef.current?.select();
    });
  };

  const handleSave = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onChange(trimmed);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      handleCancel();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <h2 className={cn("text-lg font-semibold", className)}>{value}</h2>
      </div>
    );
  }

  if (isEditing) {
    return (
      <Textarea
        ref={textareaRef}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          adjustHeight();
        }}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        className={cn(
          "w-full resize-none rounded-md border bg-background px-2 py-1 text-lg font-semibold",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      />
    );
  }

  return (
    <h2
      className={cn(
        "group group/title flex cursor-pointer items-center gap-1.5 break-words rounded-md px-2 py-1 text-lg font-semibold transition-colors hover:bg-muted/50",
        className,
      )}
      onClick={handleStartEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleStartEdit();
        }
      }}
    >
      <span className="flex-1">{value}</span>
      <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground touch-visible" />
    </h2>
  );
};
