"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const DynamicRichTextEditor = dynamic(
  () =>
    import("@/components/rich-text-editor").then((mod) => mod.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div className="overflow-hidden rounded-md border border-border bg-background">
        <div className="flex items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-1.5">
          <Skeleton className="h-7 w-48" />
        </div>
        <Skeleton className="h-[200px] w-full" />
      </div>
    ),
  }
);

export { DynamicRichTextEditor };
