"use client";

import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CopyableCodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  children?: React.ReactNode;
}

export const CopyableCodeBlock: React.FC<CopyableCodeBlockProps> = ({
  children,
  className,
  ...props
}) => {
  const [copied, setCopied] = useState(false);

  const codeElement = children as React.ReactElement<{ children?: string }>;
  const hasText = typeof codeElement?.props?.children === "string";

  const handleCopy = useCallback(() => {
    const text =
      typeof codeElement?.props?.children === "string"
        ? codeElement.props.children
        : "";

    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [codeElement]);

  return (
    <div className="relative group">
      <pre className={className} {...props}>
        {children}
      </pre>
      {hasText && (
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "absolute top-2 right-2 h-7 px-2 flex items-center gap-1.5",
            "rounded border border-border bg-muted/80 hover:bg-muted",
            "text-xs font-medium",
            "text-muted-foreground hover:text-foreground",
          )}
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-500" />
              <span>copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>copy</span>
            </>
          )}
        </button>
      )}
    </div>
  );
};
