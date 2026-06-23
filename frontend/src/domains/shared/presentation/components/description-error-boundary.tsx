import React from "react";
import { cn } from "@/lib/utils";

interface DescriptionErrorBoundaryProps {
  children: React.ReactNode;
  /** Plain text to show as fallback when rendering fails */
  fallbackText?: string;
  className?: string;
}

interface DescriptionErrorBoundaryState {
  hasError: boolean;
  prevFallbackText?: string;
}

/**
 * Error boundary for MarkdownPreview rendering.
 *
 * Must be a class component (React limitation for error boundaries).
 *
 * Usage recommendation — use `key` to reset the boundary when content changes:
 * ```tsx
 * <DescriptionErrorBoundary key={description} fallbackText={description}>
 *   <MarkdownPreview content={description} size="xs" />
 * </DescriptionErrorBoundary>
 * ```
 */
export class DescriptionErrorBoundary extends React.Component<
  DescriptionErrorBoundaryProps,
  DescriptionErrorBoundaryState
> {
  constructor(props: DescriptionErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, prevFallbackText: props.fallbackText };
  }

  static getDerivedStateFromError(): Partial<DescriptionErrorBoundaryState> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(
    props: DescriptionErrorBoundaryProps,
    state: DescriptionErrorBoundaryState,
  ): Partial<DescriptionErrorBoundaryState> | null {
    // Reset error state when fallbackText changes (content was updated)
    if (props.fallbackText !== state.prevFallbackText) {
      return { hasError: false, prevFallbackText: props.fallbackText };
    }
    return null;
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(
      "[DescriptionErrorBoundary] Failed to render markdown content:",
      error,
      errorInfo,
    );
  }

  render() {
    if (this.state.hasError) {
      const truncated = this.props.fallbackText
        ? this.props.fallbackText.length > 200
          ? `${this.props.fallbackText.slice(0, 200)}...`
          : this.props.fallbackText
        : "";

      return (
        <div className={cn("text-sm text-muted-foreground", this.props.className)}>
          <p className="whitespace-pre-wrap break-words">{truncated}</p>
          <p className="text-xs text-destructive/60 mt-1 italic">
            Failed to render formatted content
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}
