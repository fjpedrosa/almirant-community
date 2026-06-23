import Link from "next/link";
import { Unplug } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { UsageDrawerContentProps } from "../../domain/types";

export const UsageDrawerContent: React.FC<UsageDrawerContentProps> = ({
  open,
  onOpenChange,
  title,
  isLoading,
  isEmpty,
  children,
  emptyTitle,
  emptyDescription,
  manageConnectionsHref,
  manageConnectionsLabel,
}) => {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-[400px]">
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription className="sr-only">{title}</SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-3 px-4 py-3">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-2.5 rounded-lg border p-3.5">
                  <div className="flex items-center gap-2.5">
                    <Skeleton className="h-7 w-7 rounded-md" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                  <Skeleton className="h-1.5 w-3/4 rounded-full" />
                </div>
              ))
            ) : isEmpty ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Unplug className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {emptyDescription}
                </p>
              </div>
            ) : (
              children
            )}
          </div>
        </ScrollArea>

        <div className="border-t px-5 py-4">
          <Link
            href={manageConnectionsHref}
            className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            {manageConnectionsLabel}
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
};
