import { describe, expect, it } from "bun:test";
import en from "../../../../messages/en.json";
import es from "../../../../messages/es.json";
import {
  TAB_ROUTES,
  deriveActiveTab,
} from "@/app/(app-shell)/(dashboard)/components/hooks/use-navigation";

describe("Notes navigation and translations", () => {
  it("routes every Notes URL through the Notes navigation tab", () => {
    expect(TAB_ROUTES.notes).toBe("/notes");
    expect(deriveActiveTab("/notes")).toBe("notes");
    expect(deriveActiveTab("/notes/agenda/2026-08-11")).toBe("notes");
    expect(deriveActiveTab("/notes/10000000-0000-4000-8000-000000000001")).toBe("notes");
    expect(deriveActiveTab("/handbook")).toBe("handbook");
  });

  it("keeps complete matching Notes message trees in English and Spanish", () => {
    expect(en.nav.notes).toBe("Notes");
    expect(es.nav.notes).toBe("Notas");
    expect(Object.keys(en.notes).sort()).toEqual(Object.keys(es.notes).sort());
    expect(Object.keys(en.notes.editor).sort()).toEqual(Object.keys(es.notes.editor).sort());
    expect(Object.keys(en.notes.archive).sort()).toEqual(Object.keys(es.notes.archive).sort());
  });
});
