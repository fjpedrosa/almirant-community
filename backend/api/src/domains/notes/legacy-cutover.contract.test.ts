import { describe, expect, it } from "bun:test";
import { NOTES_LEGACY_CUTOVER_CONTRACT } from "./legacy-cutover.contract";

const ideationModuleSource = await Bun.file(
  new URL("../ideation/index.ts", import.meta.url),
).text();
const migrationSource = await Bun.file(
  new URL("../../../../packages/database/migrations/0229_green_santa_claus.sql", import.meta.url),
).text();

describe("Notes legacy cutover contract", () => {
  it("keeps Todo, Idea, and Seed routes mounted while insert/update writes remain bridged", () => {
    expect(NOTES_LEGACY_CUTOVER_CONTRACT).toEqual({
      authoritativeReviewSurface: "notes-legacy-archive",
      retireLegacyRoutes: false,
      canonicalSeedsPreserved: true,
      sources: [
        { sourceType: "todo", table: "todo_items", route: "todosRoutes", bridgedMutations: ["insert", "update"] },
        { sourceType: "idea", table: "idea_items", route: "ideasRoutes", bridgedMutations: ["insert", "update"] },
        { sourceType: "seed", table: "seeds", route: "seedsRoutes", bridgedMutations: ["insert", "update"] },
      ],
    });
    for (const source of NOTES_LEGACY_CUTOVER_CONTRACT.sources) {
      expect(ideationModuleSource).toContain(`.use(${source.route})`);
      expect(migrationSource).toContain(`('${source.table}','${source.sourceType}')`);
    }
    expect(migrationSource).toContain("AFTER INSERT OR UPDATE ON public.%I");
  });
});
