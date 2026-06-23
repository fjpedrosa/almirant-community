"use client";

import { isValidElement } from "react";
import { MermaidRenderer } from "@/components/ui/mermaid-renderer";
import { CopyableCodeBlock } from "./copyable-code-block";

interface PreBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  children?: React.ReactNode;
}

const extractTextContent = (
  children: unknown,
): string | null => {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) {
    const text = children
      .filter((child): child is string => typeof child === "string")
      .join("");
    return text.length > 0 ? text : null;
  }
  return null;
};

const getMermaidCode = (
  children: React.ReactNode,
): string | null => {
  if (!isValidElement(children)) return null;

  const props = children.props as {
    className?: string;
    children?: unknown;
  };

  if (
    typeof props.className === "string" &&
    props.className.includes("language-mermaid")
  ) {
    return extractTextContent(props.children);
  }

  return null;
};

export const MermaidAwareCodeBlock: React.FC<PreBlockProps> = ({
  children,
  ...props
}) => {
  const mermaidCode = getMermaidCode(children);

  if (mermaidCode) {
    return <MermaidRenderer chart={mermaidCode} />;
  }

  return <CopyableCodeBlock {...props}>{children}</CopyableCodeBlock>;
};
