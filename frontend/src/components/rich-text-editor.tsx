"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Placeholder from "@tiptap/extension-placeholder";
import { common, createLowlight } from "lowlight";
import { useEffect, useRef, useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Code2,
  Quote,
  Link as LinkIcon,
  Unlink,
  FileCode,
  Eye,
  ImageIcon,
  Loader2,
} from "lucide-react";

const lowlight = createLowlight(common);

interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
  disabled?: boolean;
  className?: string;
  onImageUpload?: (file: File) => Promise<string>;
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  onClick,
  isActive = false,
  disabled = false,
  title,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={cn(
      "inline-flex items-center justify-center rounded-md p-1.5 text-sm transition-colors",
      "hover:bg-accent hover:text-accent-foreground",
      "disabled:pointer-events-none disabled:opacity-50",
      isActive && "bg-accent text-accent-foreground"
    )}
  >
    {children}
  </button>
);

const ToolbarSeparator: React.FC = () => (
  <div className="mx-0.5 h-5 w-px bg-border" />
);

type EditorMode = "wysiwyg" | "raw";

const EDITOR_MODE_STORAGE_KEY = "rich-text-editor-mode";

const getStoredEditorMode = (): EditorMode => {
  const stored = localStorage.getItem(EDITOR_MODE_STORAGE_KEY);
  return stored === "raw" ? "raw" : "wysiwyg";
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

const EditorToolbar: React.FC<{
  editor: Editor | null;
  disabled: boolean;
  mode: EditorMode;
  onToggleMode: () => void;
  onImageUpload?: (file: File) => Promise<string>;
  isUploading: boolean;
}> = ({ editor, disabled, mode, onToggleMode, onImageUpload, isUploading }) => {
  if (!editor) return null;

  const handleImageUpload = () => {
    if (!onImageUpload) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_IMAGE_SIZE) {
        alert("Image size exceeds 5MB limit");
        return;
      }
      try {
        const url = await onImageUpload(file);
        editor.chain().focus().setImage({ src: url }).run();
      } catch {
        // Upload failed - handled by caller
      }
    };
    input.click();
  };

  const handleSetLink = () => {
    const previousUrl = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL", previousUrl ?? "");

    if (url === null) return;

    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-1.5">
      {mode === "wysiwyg" && (
        <>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive("bold")}
            disabled={disabled}
            title="Bold"
          >
            <Bold className="size-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive("italic")}
            disabled={disabled}
            title="Italic"
          >
            <Italic className="size-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive("strike")}
            disabled={disabled}
            title="Strikethrough"
          >
            <Strikethrough className="size-4" />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
            isActive={editor.isActive("heading", { level: 1 })}
            disabled={disabled}
            title="Heading 1"
          >
            <Heading1 className="size-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
            isActive={editor.isActive("heading", { level: 2 })}
            disabled={disabled}
            title="Heading 2"
          >
            <Heading2 className="size-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
            isActive={editor.isActive("heading", { level: 3 })}
            disabled={disabled}
            title="Heading 3"
          >
            <Heading3 className="size-4" />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            isActive={editor.isActive("bulletList")}
            disabled={disabled}
            title="Bullet List"
          >
            <List className="size-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            isActive={editor.isActive("orderedList")}
            disabled={disabled}
            title="Ordered List"
          >
            <ListOrdered className="size-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            isActive={editor.isActive("taskList")}
            disabled={disabled}
            title="Task List"
          >
            <ListChecks className="size-4" />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            isActive={editor.isActive("codeBlock")}
            disabled={disabled}
            title="Code Block"
          >
            <Code2 className="size-4" />
          </ToolbarButton>

          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            isActive={editor.isActive("blockquote")}
            disabled={disabled}
            title="Blockquote"
          >
            <Quote className="size-4" />
          </ToolbarButton>

          <ToolbarSeparator />

          <ToolbarButton
            onClick={handleSetLink}
            isActive={editor.isActive("link")}
            disabled={disabled}
            title="Link"
          >
            <LinkIcon className="size-4" />
          </ToolbarButton>

          {editor.isActive("link") && (
            <ToolbarButton
              onClick={() => editor.chain().focus().unsetLink().run()}
              disabled={disabled}
              title="Remove Link"
            >
              <Unlink className="size-4" />
            </ToolbarButton>
          )}

          {onImageUpload && (
            <>
              <ToolbarSeparator />
              <ToolbarButton
                onClick={handleImageUpload}
                disabled={disabled || isUploading}
                title="Insert Image"
              >
                {isUploading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImageIcon className="size-4" />
                )}
              </ToolbarButton>
            </>
          )}
        </>
      )}

      <div className="ml-auto" />

      <ToolbarButton
        onClick={onToggleMode}
        isActive={mode === "raw"}
        disabled={disabled}
        title={
          mode === "wysiwyg"
            ? "Switch to raw Markdown mode"
            : "Switch to visual editor mode"
        }
      >
        {mode === "wysiwyg" ? (
          <FileCode className="size-4" />
        ) : (
          <Eye className="size-4" />
        )}
      </ToolbarButton>
    </div>
  );
};

export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder,
  minHeight = 200,
  maxHeight,
  disabled = false,
  className,
  onImageUpload,
}) => {
  const isUpdatingFromProp = useRef(false);
  // Initialize with default to avoid hydration mismatch (localStorage
  // is unavailable during SSR). Hydrate from storage in an effect.
  const [mode, setMode] = useState<EditorMode>("wysiwyg");

  useEffect(() => {
    const stored = getStoredEditorMode();
    if (stored !== "wysiwyg") setMode(stored);
  }, []);
  const [rawContent, setRawContent] = useState(value || "");
  const [prevValue, setPrevValue] = useState(value || "");
  const [isUploading, setIsUploading] = useState(false);

  const onImageUploadRef = useRef(onImageUpload);
  onImageUploadRef.current = onImageUpload;

  const handleImageFile = useCallback(
    async (file: File, editorInstance: Editor) => {
      const uploadFn = onImageUploadRef.current;
      if (!uploadFn) return false;
      if (!file.type.startsWith("image/")) return false;
      if (file.size > MAX_IMAGE_SIZE) return false;

      setIsUploading(true);
      try {
        const url = await uploadFn(file);
        editorInstance.chain().focus().setImage({ src: url }).run();
      } catch {
        // Upload failed silently
      } finally {
        setIsUploading(false);
      }
      return true;
    },
    []
  );

  const handleUpdate = useCallback(
    ({ editor: editorInstance }: { editor: Editor }) => {
      if (isUpdatingFromProp.current) return;
      const markdown = editorInstance.getMarkdown();
      onChange(markdown);
    },
    [onChange]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Markdown,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2 cursor-pointer",
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
      }),
      ...(placeholder
        ? [Placeholder.configure({ placeholder })]
        : []),
    ],
    content: value || "",
    contentType: "markdown",
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class: cn(
          "prose dark:prose-invert prose-sm max-w-none px-3 py-2 outline-none",
          "prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2",
          "prose-h1:text-xl prose-h2:text-lg prose-h3:text-base",
          "prose-p:text-foreground prose-p:my-1",
          "prose-strong:text-foreground prose-em:text-foreground",
          "prose-a:text-primary prose-a:underline prose-a:underline-offset-2",
          "prose-blockquote:border-l-2 prose-blockquote:border-primary/40 prose-blockquote:pl-4 prose-blockquote:text-muted-foreground prose-blockquote:italic",
          "prose-code:text-primary prose-code:bg-muted prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs",
          "prose-pre:bg-muted prose-pre:rounded-md prose-pre:p-3",
          "prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5",
          "[&_ul[data-type='taskList']]:list-none [&_ul[data-type='taskList']]:pl-0",
          "[&_ul[data-type='taskList']_li]:flex [&_ul[data-type='taskList']_li]:items-start [&_ul[data-type='taskList']_li]:gap-2",
          "[&_ul[data-type='taskList']_li_label]:mt-0.5",
          "[&_ul[data-type='taskList']_li_input]:mt-1 [&_ul[data-type='taskList']_li_input]:accent-primary",
          "[&_img]:max-w-full [&_img]:rounded-md [&_img]:my-2"
        ),
      },
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (!files?.length) return false;
        const file = files[0];
        if (!file.type.startsWith("image/")) return false;
        if (!onImageUploadRef.current) return false;
        // handleImageFile is async but ProseMirror expects synchronous return
        handleImageFile(file, editor!);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        const file = files[0];
        if (!file.type.startsWith("image/")) return false;
        if (!onImageUploadRef.current) return false;
        event.preventDefault();
        handleImageFile(file, editor!);
        return true;
      },
    },
  });

  const handleToggleMode = useCallback(() => {
    setMode((prev) => {
      const next: EditorMode = prev === "wysiwyg" ? "raw" : "wysiwyg";
      localStorage.setItem(EDITOR_MODE_STORAGE_KEY, next);

      if (next === "raw" && editor) {
        // Switching to raw: capture current markdown from Tiptap
        setRawContent(editor.getMarkdown());
      } else if (next === "wysiwyg" && editor) {
        // Switching to WYSIWYG: push raw textarea content into Tiptap
        isUpdatingFromProp.current = true;
        editor.commands.setContent(rawContent, { contentType: "markdown" });
        isUpdatingFromProp.current = false;
      }

      return next;
    });
  }, [editor, rawContent]);

  const handleRawChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setRawContent(newValue);
      setPrevValue(newValue);
      onChange(newValue);
    },
    [onChange]
  );

  // Sync external value changes into the editor (WYSIWYG mode)
  useEffect(() => {
    if (!editor || mode !== "wysiwyg") return;

    const currentMarkdown = editor.getMarkdown();
    if (currentMarkdown !== value) {
      isUpdatingFromProp.current = true;
      editor.commands.setContent(value || "", { contentType: "markdown" });
      isUpdatingFromProp.current = false;
    }
  }, [editor, value, mode]);

  // Sync external value changes into raw content (raw mode).
  // Uses React's "you might not need an effect" pattern: update state during
  // render when the parent provides a value that differs from what we last saw.
  if (mode === "raw" && value !== prevValue) {
    setPrevValue(value || "");
    setRawContent(value || "");
  }

  // Sync disabled state
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-background",
        "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      <EditorToolbar
        editor={editor}
        disabled={disabled}
        mode={mode}
        onToggleMode={handleToggleMode}
        onImageUpload={onImageUpload}
        isUploading={isUploading}
      />
      <div
        className="overflow-y-auto"
        style={{
          minHeight: `${minHeight}px`,
          ...(maxHeight ? { maxHeight: `${maxHeight}px` } : {}),
        }}
      >
        {mode === "wysiwyg" ? (
          <EditorContent
            editor={editor}
            className={cn(
              "[&_.tiptap]:outline-none",
              "[&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
              "[&_.tiptap_p.is-editor-empty:first-child::before]:text-muted-foreground",
              "[&_.tiptap_p.is-editor-empty:first-child::before]:float-left",
              "[&_.tiptap_p.is-editor-empty:first-child::before]:h-0",
              "[&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none"
            )}
          />
        ) : (
          <textarea
            value={rawContent}
            onChange={handleRawChange}
            disabled={disabled}
            placeholder={placeholder}
            className={cn(
              "w-full resize-none bg-transparent px-3 py-2 text-sm text-foreground outline-none",
              "font-mono leading-relaxed",
              "placeholder:text-muted-foreground"
            )}
            style={{
              minHeight: `${minHeight}px`,
              ...(maxHeight ? { maxHeight: `${maxHeight}px` } : {}),
            }}
          />
        )}
      </div>
    </div>
  );
};
