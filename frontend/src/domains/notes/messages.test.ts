import { describe, expect, it } from "bun:test";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";

const requiredPaths = [
  "agenda.complete", "agenda.from", "agenda.invalidDate", "agenda.nextDay", "agenda.nextMonth", "agenda.pendingEmpty", "agenda.pendingTitle", "agenda.previousDay", "agenda.previousMonth",
  "archive.confirmDiscard", "archive.convert", "archive.converted", "archive.convertedStatus", "archive.description", "archive.discard", "archive.discardDescription", "archive.discardTitle", "archive.discardedStatus", "archive.emptyLegacy", "archive.emptyPages", "archive.legacy", "archive.loadMore", "archive.pages", "archive.pending", "archive.restore", "archive.sourceIdea", "archive.sourceSeed", "archive.sourceTodo", "archive.title",
  "common.cancel", "common.loading",
  "conflict.createCopy", "conflict.description", "conflict.localDraft", "conflict.reload", "conflict.retryError", "conflict.title",
  "editor.bodyPlaceholder", "editor.bold", "editor.bullet", "editor.checklist", "editor.code", "editor.completion", "editor.formatting", "editor.heading1", "editor.heading2", "editor.inlineCode", "editor.internalLink", "editor.invalidLink", "editor.italic", "editor.link", "editor.linkPrompt", "editor.memberFallback", "editor.number", "editor.pageLink", "editor.paragraph", "editor.quote", "editor.readOnly", "editor.retry", "editor.saveLink", "editor.slash", "editor.strike", "editor.titlePlaceholder", "editor.underline", "editor.untitled", "editor.updated",
  "errors.generic", "errors.navigationFlush", "errors.notFound", "errors.retry", "errors.versionConflict",
  "page.actions", "page.archive", "page.archiveConfirm", "page.archiveDescription", "page.backlinks", "page.breadcrumbs", "page.createChild", "page.move", "page.moveDescription", "page.moveTitle", "page.noBacklinks", "page.private", "page.root", "page.share", "page.updated", "page.visibility", "page.workspace",
  "share.close", "share.description", "share.editor", "share.inherited", "share.member", "share.remove", "share.role", "share.save", "share.title", "share.viewer",
  "shell.archive", "shell.collapse", "shell.expand", "shell.loading", "shell.navigation", "shell.newPage", "shell.open", "shell.pages", "shell.search", "shell.today", "shell.untitled",
];

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function placeholders(value: unknown): string[] {
  return typeof value === "string" ? [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort() : [];
}

describe("Notes translations", () => {
  it("contains every source-referenced key in both locales with matching placeholders", () => {
    for (const path of requiredPaths) {
      const enValue = getPath((en as Record<string, unknown>).notes, path);
      const esValue = getPath((es as Record<string, unknown>).notes, path);
      expect(enValue, `missing en notes.${path}`).toBeDefined();
      expect(esValue, `missing es notes.${path}`).toBeDefined();
      expect(placeholders(enValue), `placeholder mismatch en notes.${path}`).toEqual(placeholders(esValue));
    }
  });
});
