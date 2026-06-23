import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { cn } from "@/lib/utils";
import type { MarkdownPreviewProps, MarkdownPreviewSize } from "../../domain/types";
import { MermaidAwareCodeBlock } from "./mermaid-aware-code-block";

const sizeClasses: Record<MarkdownPreviewSize, string> = {
  xs: "prose-xs",
  sm: "prose-sm",
  base: "prose-base",
};

const baseProseClasses = [
  "prose dark:prose-invert max-w-none",
  // Headings
  "prose-headings:text-foreground prose-headings:font-semibold",
  "prose-headings:mt-4 prose-headings:mb-2",
  "prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base",
  // Anchor links on headings
  "[&_h1>a]:no-underline [&_h2>a]:no-underline [&_h3>a]:no-underline [&_h4>a]:no-underline",
  "[&_h1>a]:text-foreground [&_h2>a]:text-foreground [&_h3>a]:text-foreground [&_h4>a]:text-foreground",
  "[&_.heading-anchor]:opacity-0 [&_*:hover>.heading-anchor]:opacity-100 [&_.heading-anchor]:transition-opacity [&_.heading-anchor]:ml-2 [&_.heading-anchor]:text-muted-foreground",
  // Paragraphs
  "prose-p:text-foreground/90 prose-p:my-2 prose-p:leading-7",
  // Emphasis
  "prose-strong:text-foreground prose-em:text-foreground/90",
  // Links
  "prose-a:text-primary prose-a:underline prose-a:underline-offset-2 prose-a:decoration-primary/40 hover:prose-a:decoration-primary",
  // Blockquotes
  "prose-blockquote:border-l-2 prose-blockquote:border-primary/30 prose-blockquote:pl-4 prose-blockquote:text-muted-foreground prose-blockquote:italic prose-blockquote:my-3",
  // Code
  "prose-code:text-primary prose-code:bg-muted prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none",
  // Pre (code blocks)
  "prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:p-4 prose-pre:my-3",
  // Lists
  "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
  // Task list checkboxes
  "[&_input[type='checkbox']]:accent-primary [&_input[type='checkbox']]:mr-1.5 [&_input[type='checkbox']]:mt-0.5",
  "[&_li:has(input[type='checkbox'])]:list-none [&_ul:has(input[type='checkbox'])]:pl-0",
  // Horizontal rules
  "prose-hr:border-border prose-hr:my-4",
  // Tables
  "prose-th:text-foreground prose-td:text-foreground/90 prose-th:py-2 prose-td:py-2",
  // Images
  "prose-img:rounded-md prose-img:my-3",
].join(" ");

export const MarkdownPreviewWithAnchors: React.FC<MarkdownPreviewProps> = memo(
  ({ content, size = "base", className, components }) => (
    <div
      className={cn(
        baseProseClasses,
        sizeClasses[size],
        "overflow-hidden break-words",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeSlug,
          [
            rehypeAutolinkHeadings,
            {
              behavior: "append",
              properties: {
                className: ["heading-anchor"],
                ariaHidden: true,
                tabIndex: -1,
              },
              content: {
                type: "text",
                value: "#",
              },
            },
          ],
        ]}
        components={{ pre: MermaidAwareCodeBlock, ...components }}
      >
        {content}
      </ReactMarkdown>
    </div>
  ),
);

MarkdownPreviewWithAnchors.displayName = "MarkdownPreviewWithAnchors";
