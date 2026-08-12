/**
 * Transitional boundary for the first Notes delivery. The legacy routes stay
 * live while frontend writers are cut over, and migration 0229 mirrors every
 * insert/update into the authoritative Notes review archive. Seeds remain a
 * canonical Plan input and are not retired by this cutover.
 */
export const NOTES_LEGACY_CUTOVER_CONTRACT = {
  authoritativeReviewSurface: "notes-legacy-archive",
  retireLegacyRoutes: false,
  canonicalSeedsPreserved: true,
  sources: [
    {
      sourceType: "todo",
      table: "todo_items",
      route: "todosRoutes",
      bridgedMutations: ["insert", "update"],
    },
    {
      sourceType: "idea",
      table: "idea_items",
      route: "ideasRoutes",
      bridgedMutations: ["insert", "update"],
    },
    {
      sourceType: "seed",
      table: "seeds",
      route: "seedsRoutes",
      bridgedMutations: ["insert", "update"],
    },
  ],
} as const;
