import { memo, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkEmoji from "remark-emoji";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { MarkdownPreviewProps, MarkdownPreviewSize } from "../../domain/types";
import { MermaidAwareCodeBlock } from "./mermaid-aware-code-block";
import { repairDanglingMarkdownFences } from "../../application/utils/markdown-fence-repair";

const ScrollableTable = ({
  children,
  ...props
}: ComponentProps<"table">) => (
  <div className="overflow-x-auto">
    <table {...props} className="min-w-full [&_th]:max-w-64 [&_td]:max-w-64 [&_th]:break-words [&_td]:break-words [&_th]:whitespace-normal [&_td]:whitespace-normal">
      {children}
    </table>
  </div>
);

const sizeClasses: Record<MarkdownPreviewSize, string> = {
  xs: "prose-xs",
  sm: "prose-sm",
  base: "prose-base",
};

const baseProseClasses = [
  "prose dark:prose-invert max-w-none",
  // Headings
  "prose-headings:text-foreground prose-headings:font-semibold prose-headings:break-words",
  "prose-headings:mt-4 prose-headings:mb-2",
  "prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base",
  // Paragraphs
  "prose-p:text-foreground/90 prose-p:my-1.5 prose-p:break-words",
  // Emphasis
  "prose-strong:text-foreground prose-em:text-foreground/90",
  // Links
  "prose-a:text-primary prose-a:underline prose-a:underline-offset-2 prose-a:decoration-primary/40 hover:prose-a:decoration-primary",
  // Blockquotes
  "prose-blockquote:border-l-2 prose-blockquote:border-primary/30 prose-blockquote:pl-3 prose-blockquote:text-muted-foreground prose-blockquote:italic prose-blockquote:my-2",
  // Code
  "prose-code:text-primary prose-code:bg-muted prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none prose-code:break-all",
  // Pre (code blocks)
  "prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:p-3 prose-pre:my-2 prose-pre:max-w-full",
  // Lists
  "prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-li:break-words",
  // Task list checkboxes
  "[&_input[type='checkbox']]:accent-primary [&_input[type='checkbox']]:mr-1.5 [&_input[type='checkbox']]:mt-0.5",
  "[&_li:has(input[type='checkbox'])]:list-none [&_ul:has(input[type='checkbox'])]:pl-0",
  // Horizontal rules
  "prose-hr:border-border prose-hr:my-3",
  // Tables
  "prose-th:text-foreground prose-td:text-foreground/90 prose-th:py-1.5 prose-td:py-1.5",
  // Images
  "prose-img:rounded-md prose-img:my-2",
].join(" ");

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = memo(
  ({ content, size = "xs", className, components }) => {
    const repairedContent = repairDanglingMarkdownFences(content);

    // remarkBreaks converts \n to <br>, which breaks GFM table parsing.
    // Skip it when content contains markdown tables (lines starting with |).
    const hasTable = /^\|.+\|$/m.test(repairedContent);
    const plugins = hasTable
      ? [remarkGfm, remarkEmoji]
      : [remarkGfm, remarkEmoji, remarkBreaks];



    return (
      <div
        className={cn(
          baseProseClasses,
          sizeClasses[size],
          "w-full min-w-0 overflow-hidden break-words",
          className,
        )}
      >
        <ReactMarkdown
          remarkPlugins={plugins}
          components={{ pre: MermaidAwareCodeBlock, table: ScrollableTable, ...components }}
        >
          {repairedContent}
        </ReactMarkdown>
      </div>
    );
  },
);

MarkdownPreview.displayName = "MarkdownPreview";
