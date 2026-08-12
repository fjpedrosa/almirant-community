"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bold,
  Braces,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type EditorCommand =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "inline-code"
  | "bullet"
  | "number"
  | "checklist"
  | "quote"
  | "code"
  | "link"
  | "internal-link"
  | "slash";

export type EditorToolbarLabels = {
  formatting?: string;
  paragraph: string;
  heading1: string;
  heading2: string;
  bold: string;
  italic: string;
  underline: string;
  strike: string;
  inlineCode: string;
  bullet: string;
  number: string;
  checklist: string;
  quote: string;
  code: string;
  link: string;
  internalLink: string;
  slash: string;
};

const buttons: Array<{ command: EditorCommand; label: keyof EditorToolbarLabels; icon: LucideIcon; shortcut?: string }> = [
  { command: "paragraph", label: "paragraph", icon: Pilcrow },
  { command: "heading1", label: "heading1", icon: Heading1 },
  { command: "heading2", label: "heading2", icon: Heading2 },
  { command: "bold", label: "bold", icon: Bold, shortcut: "Ctrl+B" },
  { command: "italic", label: "italic", icon: Italic, shortcut: "Ctrl+I" },
  { command: "underline", label: "underline", icon: Underline, shortcut: "Ctrl+U" },
  { command: "strike", label: "strike", icon: Strikethrough },
  { command: "inline-code", label: "inlineCode", icon: Braces },
  { command: "bullet", label: "bullet", icon: List },
  { command: "number", label: "number", icon: ListOrdered },
  { command: "checklist", label: "checklist", icon: CheckSquare },
  { command: "quote", label: "quote", icon: Quote },
  { command: "code", label: "code", icon: Code2 },
  { command: "link", label: "link", icon: Link2 },
  { command: "internal-link", label: "internalLink", icon: Link2 },
];

export const EditorToolbar = ({
  editable,
  labels,
  onCommand,
  activeCommands,
}: {
  editable: boolean;
  labels: EditorToolbarLabels;
  onCommand: (command: EditorCommand) => void;
  activeCommands?: ReadonlySet<EditorCommand>;
}) => {
  if (!editable) return null;
  return (
    <div
      role="toolbar"
      aria-label={labels.formatting ?? "Editor formatting"}
      className="flex min-h-11 flex-wrap items-center gap-0.5 border-b border-border/70 px-2 py-1.5"
    >
      {buttons.map(({ command, label, icon: Icon, shortcut }) => (
        <Button
          key={command}
          type="button"
          variant="ghost"
          size="icon-sm"
          title={shortcut ? `${labels[label]} (${shortcut})` : labels[label]}
          aria-label={labels[label]}
          {...(["link", "internal-link"].includes(command) ? {} : { "aria-pressed": activeCommands?.has(command) ?? false })}
          className="min-h-11 min-w-11"
          onClick={() => onCommand(command)}
        >
          <Icon className="size-4" />
        </Button>
      ))}
    </div>
  );
};
