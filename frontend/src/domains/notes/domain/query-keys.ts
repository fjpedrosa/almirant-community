import type { NoteLegacyDispositionFilter } from "./types";

const scope = (organizationId: string | null | undefined) => `org:${organizationId ?? "none"}`;

export const notesKeys = {
  scope: (organizationId: string | null | undefined) => ["notes", scope(organizationId)] as const,
  tree: (organizationId: string | null | undefined) => ["notes", "tree", scope(organizationId)] as const,
  page: (organizationId: string | null | undefined, pageId: string) => ["notes", "page", pageId, scope(organizationId)] as const,
  search: (organizationId: string | null | undefined, query: string) => ["notes", "search", query, scope(organizationId)] as const,
  agendaMonth: (organizationId: string | null | undefined, month: string) => ["notes", "agenda", "month", month, scope(organizationId)] as const,
  agendaDay: (organizationId: string | null | undefined, date: string) => ["notes", "agenda", "day", date, scope(organizationId)] as const,
  carryover: (organizationId: string | null | undefined, date: string) => ["notes", "agenda", "carryover", date, scope(organizationId)] as const,
  checklistItems: (organizationId: string | null | undefined, pageId: string) => ["notes", "checklist-items", pageId, scope(organizationId)] as const,
  links: (organizationId: string | null | undefined, pageId: string) => ["notes", "links", pageId, scope(organizationId)] as const,
  backlinks: (organizationId: string | null | undefined, pageId: string) => ["notes", "backlinks", pageId, scope(organizationId)] as const,
  shares: (organizationId: string | null | undefined, pageId: string) => ["notes", "shares", pageId, scope(organizationId)] as const,
  archived: (organizationId: string | null | undefined) => ["notes", "archived", scope(organizationId)] as const,
  legacy: (organizationId: string | null | undefined, disposition: NoteLegacyDispositionFilter) => ["notes", "legacy", disposition, scope(organizationId)] as const,
};
