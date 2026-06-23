"use client";

import { useEffect, useRef, useState, useId } from "react";
import { useTheme } from "next-themes";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface MermaidRendererProps {
  chart: string;
  className?: string;
}

const getMermaid = async (theme: "dark" | "neutral") => {
  const mermaid = (await import("mermaid")).default;

  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: "strict",
    fontFamily: "inherit",
  });

  return mermaid;
};

export const MermaidRenderer: React.FC<MermaidRendererProps> = ({
  chart,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "rendered" | "error">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const uniqueId = useId().replace(/:/g, "-");
  const { resolvedTheme } = useTheme();

  const mermaidTheme = resolvedTheme === "dark" ? "dark" : "neutral";

  useEffect(() => {
    let cancelled = false;

    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }

    const renderChart = async () => {
      try {
        setStatus("loading");
        const mermaid = await getMermaid(mermaidTheme);

        if (cancelled || !containerRef.current) return;

        const { svg } = await mermaid.render(
          `mermaid-${uniqueId}`,
          chart.trim(),
        );

        if (cancelled || !containerRef.current) return;

        containerRef.current.innerHTML = svg;
        setStatus("rendered");
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to render diagram",
        );
        setStatus("error");
      }
    };

    renderChart();

    return () => {
      cancelled = true;
    };
  }, [chart, uniqueId, mermaidTheme]);

  if (status === "error") {
    return (
      <div className={cn("rounded-md border border-border bg-muted p-3", className)}>
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Diagram rendering failed
        </p>
        <pre className="overflow-x-auto text-xs text-muted-foreground">
          <code>{chart}</code>
        </pre>
        {errorMessage && (
          <p className="mt-1 text-[10px] text-destructive">{errorMessage}</p>
        )}
      </div>
    );
  }

  return (
    <div className={cn("my-2", className)}>
      {status === "loading" && (
        <Skeleton className="h-32 w-full rounded-md" />
      )}
      <div
        ref={containerRef}
        className={cn(
          "overflow-x-auto [&>svg]:mx-auto [&>svg]:max-w-full",
          status === "loading" && "hidden",
        )}
      />
    </div>
  );
};
