"use client";

import { useEffect, useRef, useCallback, useState, useImperativeHandle, forwardRef } from "react";
import { useTranslations } from "next-intl";
import { useEditor, EditorContent, ReactRenderer, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention, { type MentionNodeAttrs } from "@tiptap/extension-mention";
import type { SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Loader2 } from "lucide-react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import { hasVisibleContent } from "@/lib/comment-utils";
import { cn } from "@/lib/utils";
import type { TiptapCommentEditorProps, TiptapCommentEditorRef, MentionMember } from "../../domain/types";
import {
  MentionSuggestionList,
  type MentionSuggestionListRef,
} from "./mention-suggestion-list";

type SuggestionConfig = Omit<SuggestionOptions<MentionMember, MentionNodeAttrs>, "editor">;

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ACCEPTED_FILE_TYPES = [
  "image/*",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "text/plain",
  "text/csv",
].join(",");

/**
 * Resolve the best parent element for the Tippy popup.
 * When inside a Radix Sheet (modal=true), `document.body` has `pointer-events: none`,
 * so portalling the popup there makes it unclickable. Instead, we walk up from the
 * editor DOM to the closest SheetContent (which keeps `pointer-events: auto`).
 */
const resolvePopupParent = (editorElement: HTMLElement): HTMLElement => {
  const sheetContent = editorElement.closest('[data-slot="sheet-content"]');
  return (sheetContent as HTMLElement) ?? document.body;
};

/**
 * Creates the Tiptap Mention suggestion config.
 *
 * Accepts a getter function so the `items` callback always reads the latest
 * members even though the ProseMirror Suggestion plugin captures this config
 * only once (via a shallow copy in `addProseMirrorPlugins`). Without this
 * indirection, members fetched asynchronously (e.g. from useTeamMembersSelect)
 * would never appear because the initial empty array is baked into the closure
 * at editor creation.
 */
const createSuggestionConfig = (
  getMembers: () => MentionMember[],
): SuggestionConfig => ({
  items: ({ query }) => {
    const lower = query.toLowerCase();
    return getMembers()
      .filter((m) => (m.name || m.email).toLowerCase().includes(lower))
      .slice(0, 8);
  },
  render: () => {
    let component: ReactRenderer<MentionSuggestionListRef> | null = null;
    let popup: TippyInstance[] | null = null;

    return {
      onStart: (props: SuggestionProps<MentionMember, MentionNodeAttrs>) => {
        component = new ReactRenderer(MentionSuggestionList, {
          props,
          editor: props.editor,
        });

        if (!props.clientRect) return;

        const editorElement = props.editor.view.dom;

        popup = tippy("body", {
          getReferenceClientRect: props.clientRect as () => DOMRect,
          appendTo: () => resolvePopupParent(editorElement),
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: "manual",
          placement: "bottom-start",
        });
      },
      onUpdate: (props: SuggestionProps<MentionMember, MentionNodeAttrs>) => {
        component?.updateProps(props);
        if (props.clientRect && popup?.[0]) {
          popup[0].setProps({
            getReferenceClientRect: props.clientRect as () => DOMRect,
          });
        }
      },
      onKeyDown: (props: { event: KeyboardEvent }) => {
        if (props.event.key === "Escape") {
          popup?.[0]?.hide();
          return true;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        popup?.[0]?.destroy();
        component?.destroy();
      },
    };
  },
});

type ImageOverlay = {
  src: string;
  top: number;
  left: number;
  width: number;
  height: number;
  buttonTop: number;
  buttonLeft: number;
  isUploading: boolean;
};

const normalizeEditorHtml = (html: string): string =>
  hasVisibleContent(html) ? html : "";

const areImageOverlaysEqual = (
  current: ImageOverlay[],
  next: ImageOverlay[],
): boolean => {
  if (current.length !== next.length) return false;

  return current.every((overlay, index) => {
    const nextOverlay = next[index];
    if (!nextOverlay) return false;

    return (
      overlay.src === nextOverlay.src &&
      overlay.top === nextOverlay.top &&
      overlay.left === nextOverlay.left &&
      overlay.width === nextOverlay.width &&
      overlay.height === nextOverlay.height &&
      overlay.buttonTop === nextOverlay.buttonTop &&
      overlay.buttonLeft === nextOverlay.buttonLeft &&
      overlay.isUploading === nextOverlay.isUploading
    );
  });
};

export const TiptapCommentEditor = forwardRef<TiptapCommentEditorRef, TiptapCommentEditorProps>(({
  value,
  onChange,
  onSubmit,
  members,
  placeholder: placeholderProp,
  disabled = false,
  onImageUpload,
  onFileUpload,
  onUploadingChange,
}, ref) => {
  const t = useTranslations("shared.editor");
  const tc = useTranslations("shared.comments");
  const placeholder = placeholderProp ?? tc("writePlaceholder");
  const isUpdatingFromProp = useRef(false);
  const onChangeRef = useRef(onChange);
  const onSubmitRef = useRef(onSubmit);
  const membersRef = useRef(members);
  const onImageUploadRef = useRef(onImageUpload);
  const onFileUploadRef = useRef(onFileUpload);
  const onUploadingChangeRef = useRef(onUploadingChange);
  const lastReportedUploadingRef = useRef<boolean | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const editorContentRef = useRef<HTMLDivElement | null>(null);
  const uploadedImageUrlsRef = useRef(new Map<string, string>());
  const previewImageUrlsRef = useRef(new Set<string>());
  const [pendingUploadsCount, setPendingUploadsCount] = useState(0);
  const [uploadingImageUrls, setUploadingImageUrls] = useState<string[]>([]);
  const [imageOverlays, setImageOverlays] = useState<ImageOverlay[]>([]);
  const isUploading = pendingUploadsCount > 0;

  useEffect(() => {
    onChangeRef.current = onChange;
    onSubmitRef.current = onSubmit;
  });

  useEffect(() => {
    onImageUploadRef.current = onImageUpload;
  }, [onImageUpload]);

  useEffect(() => {
    onFileUploadRef.current = onFileUpload;
  }, [onFileUpload]);

  useEffect(() => {
    onUploadingChangeRef.current = onUploadingChange;
  }, [onUploadingChange]);

  // Keep the ref in sync so the suggestion `items` callback always reads
  // the latest members, even when they arrive asynchronously after the
  // Tiptap editor (and its ProseMirror Suggestion plugin) has been created.
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  // Notify parent of uploading state changes
  useEffect(() => {
    if (lastReportedUploadingRef.current === isUploading) {
      return;
    }

    lastReportedUploadingRef.current = isUploading;
    onUploadingChangeRef.current?.(isUploading);
  }, [isUploading]);

  // Stable getter captured once by the suggestion config closure.
  // Uses useCallback so the identity never changes, and reads from the ref
  // only when invoked (inside the suggestion plugin, not during render).
  const getMembers = useCallback(() => membersRef.current, []);

  const removeImageBySource = useCallback(
    (editorInstance: Editor, src: string) => {
      const { state, view } = editorInstance;
      let imageFrom = -1;
      let imageTo = -1;

      state.doc.descendants((node, pos) => {
        if (node.type.name === "image" && node.attrs.src === src) {
          imageFrom = pos;
          imageTo = pos + node.nodeSize;
          return false;
        }
        return true;
      });

      if (imageFrom === -1 || imageTo === -1) {
        return false;
      }

      view.dispatch(state.tr.delete(imageFrom, imageTo));
      return true;
    },
    [],
  );

  const serializeEditorHtml = useCallback((html: string) => {
    let serializedHtml = html;

    for (const [previewUrl, uploadedUrl] of uploadedImageUrlsRef.current.entries()) {
      serializedHtml = serializedHtml
        .split(`src="${previewUrl}"`)
        .join(`src="${uploadedUrl}"`);
    }

    return serializedHtml;
  }, []);

  const releasePreviewUrl = useCallback((previewUrl: string) => {
    uploadedImageUrlsRef.current.delete(previewUrl);
    setUploadingImageUrls((current) => current.filter((value) => value !== previewUrl));

    if (!previewImageUrlsRef.current.has(previewUrl)) {
      return;
    }

    URL.revokeObjectURL(previewUrl);
    previewImageUrlsRef.current.delete(previewUrl);
  }, []);

  const clearPendingPreviewUrls = useCallback(() => {
    for (const previewUrl of previewImageUrlsRef.current) {
      URL.revokeObjectURL(previewUrl);
    }

    previewImageUrlsRef.current.clear();
    uploadedImageUrlsRef.current.clear();
    setPendingUploadsCount(0);
    setUploadingImageUrls([]);
    setImageOverlays([]);
  }, []);

  const beginUpload = useCallback(() => {
    setPendingUploadsCount((current) => current + 1);
  }, []);

  const finishUpload = useCallback(() => {
    setPendingUploadsCount((current) => Math.max(0, current - 1));
  }, []);

  const syncImageOverlays = useCallback(() => {
    const editorElement = editorContentRef.current?.querySelector('[contenteditable="true"]');
    if (!editorElement) {
      setImageOverlays((current) => (current.length === 0 ? current : []));
      return;
    }

    const containerRect = editorElement.getBoundingClientRect();
    const uploadingImageUrlSet = new Set(uploadingImageUrls);
    const nextOverlays = Array.from(editorElement.querySelectorAll("img"))
      .map((img) => {
        const src = img.getAttribute("src");
        if (!src) return null;

        const rect = img.getBoundingClientRect();
        return {
          src,
          top: rect.top - containerRect.top,
          left: rect.left - containerRect.left,
          width: rect.width,
          height: rect.height,
          buttonTop: rect.top - containerRect.top + 4,
          buttonLeft: rect.left - containerRect.left + rect.width - 22,
          isUploading: uploadingImageUrlSet.has(src),
        };
      })
      .filter((overlay): overlay is ImageOverlay => overlay !== null);

    setImageOverlays((current) =>
      areImageOverlaysEqual(current, nextOverlays) ? current : nextOverlays
    );
  }, [uploadingImageUrls]);

  const handleRemoveImage = useCallback(
    (src: string) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) return;

      const removed = removeImageBySource(currentEditor, src);
      if (!removed) return;

      releasePreviewUrl(src);
      onChangeRef.current(serializeEditorHtml(currentEditor.getHTML()));
      requestAnimationFrame(syncImageOverlays);
    },
    [releasePreviewUrl, removeImageBySource, serializeEditorHtml, syncImageOverlays],
  );

  const handleImageFile = useCallback(
    async (file: File, editorInstance: Editor) => {
      const uploadFn = onImageUploadRef.current;
      if (!uploadFn) return false;
      if (!file.type.startsWith("image/")) return false;
      if (file.size > MAX_IMAGE_SIZE) return false;

      const previewUrl = URL.createObjectURL(file);
      previewImageUrlsRef.current.add(previewUrl);
      setUploadingImageUrls((current) => [...current, previewUrl]);
      editorInstance
        .chain()
        .focus()
        .setImage({ src: previewUrl, alt: file.name })
        .run();

      beginUpload();
      requestAnimationFrame(syncImageOverlays);
      try {
        const url = await uploadFn(file);
        uploadedImageUrlsRef.current.set(previewUrl, url);
        onChangeRef.current(serializeEditorHtml(editorInstance.getHTML()));
        requestAnimationFrame(syncImageOverlays);
      } catch {
        removeImageBySource(editorInstance, previewUrl);
        releasePreviewUrl(previewUrl);
        requestAnimationFrame(syncImageOverlays);
      } finally {
        setUploadingImageUrls((current) => current.filter((value) => value !== previewUrl));
        finishUpload();
        requestAnimationFrame(syncImageOverlays);
      }
      return true;
    },
    [beginUpload, finishUpload, releasePreviewUrl, removeImageBySource, serializeEditorHtml, syncImageOverlays],
  );

  const handleNonImageFile = useCallback(
    async (file: File, editorInstance: Editor) => {
      const uploadFn = onFileUploadRef.current;
      if (!uploadFn) return false;
      if (file.size > MAX_FILE_SIZE) return false;

      beginUpload();
      try {
        const result = await uploadFn(file);
        // Insert a downloadable link into the editor with file-link class for styling
        editorInstance
          .chain()
          .focus()
          .insertContent(
            `<a href="${result.url}" target="_blank" rel="noopener noreferrer" class="file-link" data-filename="${result.fileName}">${result.fileName}</a> `
          )
          .run();
      } catch {
        // Upload failed silently
      } finally {
        finishUpload();
      }
      return true;
    },
    [beginUpload, finishUpload]
  );

  const handleFileButtonClick = useCallback(() => {
    const currentEditor = editorRef.current;
    if (!currentEditor) return;

    const hasImageUpload = !!onImageUploadRef.current;
    const hasFileUpload = !!onFileUploadRef.current;
    if (!hasImageUpload && !hasFileUpload) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = hasFileUpload ? ACCEPTED_FILE_TYPES : "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      const isImage = file.type.startsWith("image/");

      if (isImage) {
        if (file.size > MAX_IMAGE_SIZE) {
          alert(t("imageSizeError"));
          return;
        }
        await handleImageFile(file, currentEditor);
      } else {
        if (file.size > MAX_FILE_SIZE) {
          alert(t("fileSizeError"));
          return;
        }
        await handleNonImageFile(file, currentEditor);
      }
    };
    input.click();
  }, [handleImageFile, handleNonImageFile, t]);

  const handleDroppedFiles = useCallback(
    async (files: File[]) => {
      const currentEditor = editorRef.current;
      const file = files[0];
      if (!currentEditor || !file) return;

      if (file.type.startsWith("image/")) {
        await handleImageFile(file, currentEditor);
        return;
      }

      await handleNonImageFile(file, currentEditor);
    },
    [handleImageFile, handleNonImageFile],
  );

  // Expose triggerFileUpload to parent via ref
  useImperativeHandle(ref, () => ({
    triggerFileUpload: handleFileButtonClick,
    handleDroppedFiles,
  }), [handleDroppedFiles, handleFileButtonClick]);

  const handleUpdate = useCallback(
    ({ editor: editorInstance }: { editor: { getHTML: () => string } }) => {
      if (isUpdatingFromProp.current) return;
      onChangeRef.current(normalizeEditorHtml(serializeEditorHtml(editorInstance.getHTML())));
    },
    [serializeEditorHtml]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: {
          class: "tiptap-image",
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline cursor-pointer",
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      Mention.configure({
        HTMLAttributes: {
          class: "mention",
        },
        suggestion: createSuggestionConfig(getMembers),
      }),
    ],
    content: value || "",
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class: cn(
          "prose dark:prose-invert prose-sm max-w-none px-3 py-2 outline-none min-h-[38px]",
          "prose-p:text-foreground prose-p:my-0",
          "[&_.mention]:bg-primary/15 [&_.mention]:text-primary [&_.mention]:rounded [&_.mention]:px-1 [&_.mention]:py-0.5 [&_.mention]:font-medium",
          // Image styling with delete button support
          "[&_img]:h-20 [&_img]:w-20 [&_img]:max-w-none [&_img]:rounded-md [&_img]:my-2 [&_img]:object-cover [&_img]:border [&_img]:border-border/60 [&_img]:bg-muted/20",
          "[&_img.tiptap-image]:relative [&_img.tiptap-image]:group",
          // File link styling - make them look like cards
          "[&_a]:text-primary [&_a]:underline [&_a]:cursor-pointer",
          "[&_a.file-link]:inline-flex [&_a.file-link]:items-center [&_a.file-link]:gap-2 [&_a.file-link]:px-3 [&_a.file-link]:py-1.5 [&_a.file-link]:my-1 [&_a.file-link]:rounded-md [&_a.file-link]:border [&_a.file-link]:border-border [&_a.file-link]:bg-muted/30 [&_a.file-link]:no-underline [&_a.file-link]:text-foreground [&_a.file-link]:hover:bg-muted/50 [&_a.file-link]:transition-colors [&_a.file-link]:max-w-full"
        ),
      },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onSubmitRef.current();
          return true;
        }
        return false;
      },
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (!files?.length) return false;
        const file = files[0];
        if (!file.type.startsWith("image/")) return false;
        if (!onImageUploadRef.current || !editorRef.current) return false;
        handleImageFile(file, editorRef.current);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files?.length) return false;
        if (!editorRef.current) return false;

        const file = files[0];
        const isImage = file.type.startsWith("image/");

        if (isImage) {
          if (!onImageUploadRef.current) return false;
        } else {
          if (!onFileUploadRef.current) return false;
        }

        // Prevent default to stop propagation to parent FileDropZone
        event.preventDefault();
        void handleDroppedFiles(Array.from(files));

        return true;
      },
    },
  }, [getMembers, handleDroppedFiles, handleUpdate, placeholder, disabled]);

  // Keep editorRef in sync for paste/drop/image-button handlers
  editorRef.current = editor;

  // Sync external value changes (e.g. after submit, parent resets to "")
  useEffect(() => {
    if (!editor) return;
    const currentHtml = normalizeEditorHtml(serializeEditorHtml(editor.getHTML()));
    const normalizedValue = normalizeEditorHtml(value);

    if (normalizedValue !== currentHtml) {
      isUpdatingFromProp.current = true;
      editor.commands.setContent(normalizedValue || "");
      isUpdatingFromProp.current = false;

      if (!normalizedValue) {
        clearPendingPreviewUrls();
      }
    }
  }, [clearPendingPreviewUrls, editor, serializeEditorHtml, value]);

  useEffect(() => () => {
    clearPendingPreviewUrls();
  }, [clearPendingPreviewUrls]);

  // Sync disabled state
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  // Keep overlay delete buttons aligned with the visible thumbnails
  useEffect(() => {
    if (!editor || disabled) return;

    const updateListener = () => {
      requestAnimationFrame(syncImageOverlays);
    };

    syncImageOverlays();
    editor.on("update", updateListener);
    window.addEventListener("resize", updateListener);

    return () => {
      editor.off("update", updateListener);
      window.removeEventListener("resize", updateListener);
    };
  }, [disabled, editor, syncImageOverlays]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-border bg-background text-sm",
        "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <div ref={editorContentRef}>
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
      </div>
      {imageOverlays.map((overlay) => (
        <div key={overlay.src}>
          {overlay.isUploading && (
            <div
              className="pointer-events-none absolute z-10 flex items-center justify-center rounded-md bg-background/45"
              style={{
                top: overlay.top,
                left: overlay.left,
                width: overlay.width,
                height: overlay.height,
              }}
            >
              <Loader2 className="h-5 w-5 animate-spin text-foreground/80" aria-hidden="true" />
            </div>
          )}
          <button
            type="button"
            className={cn(
              "absolute z-20 inline-flex h-5 w-5 items-center justify-center rounded-full",
              "bg-background/95 text-foreground shadow-sm ring-1 ring-border/80",
              "transition-colors hover:bg-destructive hover:text-destructive-foreground",
              "focus:outline-none focus:ring-2 focus:ring-ring/60"
            )}
            style={{ top: overlay.buttonTop, left: overlay.buttonLeft }}
            onClick={() => handleRemoveImage(overlay.src)}
            aria-label={t("removeImage")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
});

TiptapCommentEditor.displayName = "TiptapCommentEditor";
