"use client";

import Link from "next/link";
import { Archive, CalendarDays, ChevronDown, ChevronRight, FileText, Menu, Plus, Search } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { NoteTreeNode } from "../../domain/types";

type Labels = { navigation: string; today: string; pages: string; archive: string; open: string; search: string; newPage: string; untitled?: string; expand?: (title: string) => string; collapse?: (title: string) => string };

const TreeLinks = ({ pages, activePageId, labels, depth = 0, onNavigate }: { pages: NoteTreeNode[]; activePageId?: string | null; labels: Labels; depth?: number; onNavigate?: () => void }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <ul className="space-y-0.5">
      {pages.map((page) => {
        const hasChildren = page.children.length > 0;
        const closed = collapsed.has(page.id);
        return (
          <li key={page.id}>
            <div className="flex min-w-0 items-center" style={{ paddingInlineStart: `${depth * 12}px` }}>
              {hasChildren ? (
                <button
                  type="button"
                  aria-label={closed ? labels.expand?.(page.title) ?? `Expand ${page.title}` : labels.collapse?.(page.title) ?? `Collapse ${page.title}`}
                  aria-expanded={!closed}
                  onClick={() => setCollapsed((value) => {
                    const next = new Set(value);
                    if (next.has(page.id)) next.delete(page.id); else next.add(page.id);
                    return next;
                  })}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                >
                  {closed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>
              ) : <span className="w-7 shrink-0" />}
              <Link
                href={`/notes/${page.id}`}
                aria-current={activePageId === page.id ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                  activePageId === page.id && "bg-muted font-medium text-foreground",
                )}
              >
                {page.title || labels.untitled || "Untitled"}
              </Link>
            </div>
            {hasChildren && !closed && <TreeLinks pages={page.children} activePageId={activePageId} labels={labels} depth={depth + 1} onNavigate={onNavigate} />}
          </li>
        );
      })}
    </ul>
  );
};

const SidebarBody = ({ pages, activePageId, labels, onCreatePage, search, onSearchChange, footer, onNavigate }: {
  pages: NoteTreeNode[];
  activePageId?: string | null;
  labels: Labels;
  onCreatePage: () => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  footer?: ReactNode;
  onNavigate?: () => void;
}) => (
  <nav aria-label={labels.navigation} className="flex h-full flex-col">
    <div className="border-b border-sidebar-border px-3 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input aria-label={labels.search} value={search ?? ""} onChange={(event) => onSearchChange?.(event.target.value)} placeholder={labels.search} className="h-9 pl-8" />
      </div>
    </div>
    <div className="space-y-1 px-2 py-3">
      <Link href="/notes" onClick={onNavigate} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent">
        <CalendarDays className="size-4 text-primary" />{labels.today}
      </Link>
      <Link href="/notes/archive" onClick={onNavigate} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-sidebar-accent">
        <Archive className="size-4 text-muted-foreground" />{labels.archive}
      </Link>
    </div>
    <div className="flex items-center justify-between px-4 pb-2 pt-1">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{labels.pages}</span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={labels.newPage} onClick={() => { onNavigate?.(); onCreatePage(); }}><Plus className="size-4" /></Button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
      {pages.length > 0 ? <TreeLinks pages={pages} activePageId={activePageId} labels={labels} onNavigate={onNavigate} /> : (
        <div className="px-3 py-8 text-center text-sm text-muted-foreground"><FileText className="mx-auto mb-2 size-5" />{labels.newPage}</div>
      )}
    </div>
    {footer && <div className="shrink-0 border-t border-sidebar-border">{footer}</div>}
  </nav>
);

export const NotesSidebar = ({ pages, activePageId, labels, onCreatePage, search, onSearchChange, footer }: {
  pages: NoteTreeNode[];
  activePageId?: string | null;
  labels: Labels;
  onCreatePage: () => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  footer?: ReactNode;
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
    <aside className="hidden h-full w-72 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:block">
      <SidebarBody {...{ pages, activePageId, labels, onCreatePage, search, onSearchChange, footer }} />
    </aside>
    <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label={labels.open} className="fixed bottom-4 left-4 z-30 shadow-md md:hidden">
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>
      <SheetContent data-notes-surface side="left" className="w-[min(88vw,320px)] p-0 pt-14">
        <SheetTitle className="sr-only">{labels.navigation}</SheetTitle>
        <SidebarBody {...{ pages, activePageId, labels, onCreatePage, search, onSearchChange, footer }} onNavigate={() => setMobileOpen(false)} />
      </SheetContent>
    </Sheet>
    </>
  );
};
