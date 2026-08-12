import { beforeEach, describe, expect, it } from "bun:test";
import {
  createNotesService,
  NotesServiceError,
  type NotesActor,
} from "./notes.service";

const actor: NotesActor = { workspaceId: "workspace-1", userId: "owner-1" };
const page = {
  id: "10000000-0000-4000-8000-000000000001",
  workspaceId: actor.workspaceId,
  ownerUserId: actor.userId,
  parentId: null,
  kind: "page" as const,
  dailyDate: null,
  visibility: "private" as const,
  title: "Page",
  position: 0,
  lexicalJson: { root: { type: "root", version: 1, children: [] } },
  lexicalSchemaVersion: 1,
  markdownProjection: "Page markdown",
  plaintextProjection: "Page plain",
  searchVector: "",
  stateVersion: 3,
  provenance: "user" as const,
  createdByKind: "user" as const,
  updatedByKind: "user" as const,
  createdByUserId: actor.userId,
  updatedByUserId: actor.userId,
  createdByAgentJobId: null,
  updatedByAgentJobId: null,
  createdByChannel: null,
  updatedByChannel: null,
  createdByTool: null,
  updatedByTool: null,
  archivedAt: null,
  createdAt: new Date("2026-08-10T00:00:00.000Z"),
  updatedAt: new Date("2026-08-10T00:00:00.000Z"),
};

const collection = <T>(items: T[], limit = 50, offset = 0) => ({
  items,
  pagination: { limit, offset, hasMore: false, nextOffset: null },
});
const legacySummaryKeys = [
  "convertedActionId",
  "convertedPageId",
  "createdAt",
  "disposition",
  "dispositionAt",
  "id",
  "sourceId",
  "sourcePreview",
  "sourceTitle",
  "sourceType",
  "updatedAt",
];

const makeRepository = () => ({
  createPage: async (input: Record<string, unknown>) => ({ ...page, ...input }),
  getPage: async (_actor: NotesActor, pageId: string) =>
    pageId === page.id ? { ...page } : null,
  getOwnedPageIncludingArchived: async (_actor: NotesActor, pageId: string) =>
    pageId === page.id ? { ...page, archivedAt: new Date("2026-08-10T00:00:00Z") } : null,
  archivedPages: async (..._args: any[]): Promise<any> => collection([{ ...page, archivedAt: new Date("2026-08-10T00:00:00Z") }]),
  updatePage: async (input: Record<string, unknown>) => ({
    ...page,
    ...input,
    stateVersion: page.stateVersion + 1,
  }),
  getOrCreateDaily: async (_actor: NotesActor, dailyDate: string) => ({
    ...page,
    id: `daily-${dailyDate}`,
    kind: "daily",
    dailyDate,
  }),
  listDailyByMonth: async () => collection([{ ...page, kind: "daily", dailyDate: "2026-08-11" }]),
  pageTree: async () => collection([{ ...page }]),
  search: async (_actor: NotesActor, _query: string, _pagination: { limit?: number; offset?: number }) => collection([{ ...page }]),
  listShares: async () => collection([]),
  setShare: async (input: Record<string, unknown>) => ({ id: "share-1", ...input }),
  removeShare: async () => true,
  reparent: async (input: Record<string, unknown>) => ({ ...page, ...input }),
  pendingCarryover: async () => collection([]),
  dailyCarryover: async () => collection([]),
  listDailyCarryover: async () => collection([]),
  updateCarryoverItem: async () => null,
  updateChecklistItem: async (input: Record<string, unknown>) => ({ id: "check-1", ...input }),
  listChecklistItems: async (): Promise<any> => collection([]),
  links: async () => collection([]),
  backlinks: async () => collection([]),
  legacy: async (_actor: NotesActor, _options: { disposition?: string; limit?: number; offset?: number }) => collection<any>([]),
  getLegacy: async (_actor: NotesActor, archiveId: string) =>
    archiveId === "visible" ? { id: "visible", disposition: "pending" } : null,
  convertLegacy: async (input: Record<string, unknown>) => ({ id: "legacy-1", ...input }),
  discardLegacy: async (input: Record<string, unknown>) => ({ id: "legacy-1", ...input }),
});

describe("NotesService", () => {
  let repository: ReturnType<typeof makeRepository>;

  beforeEach(() => {
    repository = makeRepository();
  });

  it("lists bounded checklist audit summaries only after page visibility is established", async () => {
    const summary = {
      itemId: "20000000-0000-4000-8000-000000000001",
      ordinal: 0,
      text: "Ship the release",
      checked: true,
      completedAt: new Date("2026-08-11T09:00:00.000Z"),
      completedByUserId: actor.userId,
      updatedAt: new Date("2026-08-11T09:00:00.000Z"),
    };
    let reads = 0;
    let received: unknown;
    repository.listChecklistItems = async (...args: any[]) => {
      reads += 1;
      received = args;
      return collection([summary], 25, 3);
    };
    const service = createNotesService(repository as never);

    const result = await service.listChecklistItems(actor, page.id, { limit: 25, offset: 3 });
    expect(result).toEqual(collection([summary], 25, 3));
    expect(received).toEqual([actor, page.id, { limit: 25, offset: 3 }]);
    expect(Object.keys(result.items[0]!).sort()).toEqual([
      "checked",
      "completedAt",
      "completedByUserId",
      "itemId",
      "ordinal",
      "text",
      "updatedAt",
    ]);

    await expect(service.listChecklistItems(actor, "missing", { limit: 25 })).rejects.toMatchObject({
      code: "NOTE_NOT_FOUND",
      status: 404,
    });
    expect(reads).toBe(1);
  });

  it("returns create and daily command snapshots without a post-command hydration read", async () => {
    const activeCapabilities = {
      canEdit: true,
      canManageShares: true,
      canReparent: true,
      canArchive: true,
      canChangeVisibility: true,
      canRestore: false,
    };
    const createdSnapshot = {
      ...page,
      title: "Committed create snapshot",
      stateVersion: 1,
      ...activeCapabilities,
    };
    const dailySnapshot = {
      ...page,
      id: "10000000-0000-4000-8000-000000000099",
      kind: "daily" as const,
      dailyDate: "2026-08-12",
      title: "2026-08-12",
      stateVersion: 1,
      ...activeCapabilities,
      canArchive: false,
    };
    let hydrationReads = 0;
    repository.createPage = async () => createdSnapshot as never;
    repository.getOrCreateDaily = async () => dailySnapshot as never;
    repository.getPage = async () => {
      hydrationReads += 1;
      throw new Error("POST_COMMAND_HYDRATION_READ");
    };
    const service = createNotesService(repository as never);

    expect(await service.createPage(actor, { title: "Requested title" })).toBe(createdSnapshot);
    expect(await service.getOrCreateAgendaDay(actor, "2026-08-12")).toBe(dailySnapshot);
    expect(hydrationReads).toBe(0);
  });

  it("returns update, visibility, and reparent snapshots without reading after the write", async () => {
    const current = {
      ...page,
      canEdit: true,
      canManageShares: true,
      canReparent: true,
      canArchive: true,
      canChangeVisibility: true,
      canRestore: false,
    };
    const updatedSnapshot = { ...current, title: "Committed update", stateVersion: 4 };
    const visibilitySnapshot = { ...current, visibility: "workspace" as const, stateVersion: 4 };
    const reparentSnapshot = {
      ...current,
      parentId: "10000000-0000-4000-8000-000000000002",
      stateVersion: 4,
    };
    let writeCommitted = false;
    let preWriteReads = 0;
    repository.getPage = async () => {
      if (writeCommitted) throw new Error("POST_COMMAND_HYDRATION_READ");
      preWriteReads += 1;
      return current as never;
    };
    repository.updatePage = async (input) => {
      writeCommitted = true;
      return (input.visibility === "workspace" ? visibilitySnapshot : updatedSnapshot) as never;
    };
    repository.reparent = async () => {
      writeCommitted = true;
      return reparentSnapshot as never;
    };
    const service = createNotesService(repository as never);

    expect(await service.updatePage(actor, page.id, {
      expectedVersion: page.stateVersion,
      title: "Requested update",
    })).toBe(updatedSnapshot);
    writeCommitted = false;
    expect(await service.updatePage(actor, page.id, {
      expectedVersion: page.stateVersion,
      visibility: "workspace",
    })).toBe(visibilitySnapshot);
    writeCommitted = false;
    expect(await service.reparentPage(actor, page.id, {
      expectedVersion: page.stateVersion,
      parentId: reparentSnapshot.parentId,
    })).toBe(reparentSnapshot);
    expect(preWriteReads).toBe(3);
  });

  it("returns archive and restore snapshots with capabilities from their own committed states", async () => {
    const active = {
      ...page,
      canEdit: true,
      canManageShares: true,
      canReparent: true,
      canArchive: true,
      canChangeVisibility: true,
      canRestore: false,
    };
    const archived = {
      ...active,
      stateVersion: 4,
      archivedAt: new Date("2026-08-12T10:00:00.000Z"),
      canEdit: false,
      canManageShares: false,
      canReparent: false,
      canArchive: false,
      canChangeVisibility: false,
      canRestore: true,
    };
    const restored = { ...active, stateVersion: 5 };
    let writeCommitted = false;
    let getPageReads = 0;
    let ownedReads = 0;
    repository.getPage = async () => {
      if (writeCommitted) throw new Error("POST_COMMAND_HYDRATION_READ");
      getPageReads += 1;
      return active as never;
    };
    repository.getOwnedPageIncludingArchived = async () => {
      if (writeCommitted) throw new Error("POST_COMMAND_HYDRATION_READ");
      ownedReads += 1;
      return archived as never;
    };
    repository.updatePage = async (input) => {
      writeCommitted = true;
      return (input.archivedAt === null ? restored : archived) as never;
    };
    const service = createNotesService(repository as never);

    expect(await service.archivePage(actor, page.id, {
      expectedVersion: page.stateVersion,
    })).toBe(archived);
    writeCommitted = false;
    expect(await service.restorePage(actor, page.id, {
      expectedVersion: archived.stateVersion,
    })).toBe(restored);
    expect(getPageReads).toBe(1);
    expect(ownedReads).toBe(1);
  });

  it("keeps checklist, share, and legacy command DTOs exact without follow-up list hydration", async () => {
    const checklistItem = {
      id: "30000000-0000-4000-8000-000000000001",
      itemId: "20000000-0000-4000-8000-000000000001",
      pageId: page.id,
      workspaceId: actor.workspaceId,
      ordinal: 0,
      text: "Completed item",
      checked: true,
      completedAt: new Date("2026-08-12T10:00:00.000Z"),
      completedByKind: "user" as const,
      completedByUserId: actor.userId,
      completedByAgentJobId: null,
      completedByChannel: null,
      completedByTool: null,
      updatedByUserId: actor.userId,
      updatedByKind: "user" as const,
      updatedByAgentJobId: null,
      updatedByChannel: null,
      updatedByTool: null,
      updatedAt: new Date("2026-08-12T10:00:00.000Z"),
    };
    const checklistSnapshot = {
      ...checklistItem,
      item: checklistItem,
      page: {
        ...page,
        stateVersion: page.stateVersion + 1,
        canEdit: true,
        canManageShares: true,
        canReparent: true,
        canArchive: true,
        canChangeVisibility: true,
        canRestore: false,
      },
    };
    const shareSnapshot = { id: "share-snapshot", pageId: page.id, role: "editor" };
    const conversionSnapshot = {
      id: "visible",
      sourceType: "idea" as const,
      sourceId: "source-1",
      sourceTitle: "Legacy idea",
      sourcePreview: "Legacy preview",
      disposition: "converted" as const,
      convertedPageId: page.id,
      convertedActionId: "atomic-action",
      dispositionAt: new Date("2026-08-12T10:00:00.000Z"),
      createdAt: new Date("2026-08-11T10:00:00.000Z"),
      updatedAt: new Date("2026-08-12T10:00:00.000Z"),
    };
    let pageReads = 0;
    let legacyReads = 0;
    let collectionReads = 0;
    repository.getPage = async () => {
      pageReads += 1;
      if (pageReads > 1) throw new Error("POST_COMMAND_HYDRATION_READ");
      return { ...page } as never;
    };
    repository.updateChecklistItem = async () => checklistSnapshot as never;
    repository.setShare = async () => shareSnapshot as never;
    repository.removeShare = async () => true;
    repository.listShares = async () => {
      collectionReads += 1;
      return collection([]);
    };
    repository.getLegacy = async () => {
      legacyReads += 1;
      if (legacyReads > 1) throw new Error("POST_COMMAND_HYDRATION_READ");
      return { id: "visible", disposition: "pending" } as never;
    };
    repository.legacy = async () => {
      collectionReads += 1;
      return collection([]);
    };
    repository.convertLegacy = async () => conversionSnapshot as never;
    const service = createNotesService(repository as never);

    const checklistPublic = await service.updateChecklistItem(
      actor,
      page.id,
      checklistSnapshot.itemId,
      { checked: true, expectedVersion: page.stateVersion },
    );
    expect(checklistPublic.item).toEqual({
      itemId: checklistSnapshot.itemId,
      ordinal: checklistSnapshot.ordinal,
      text: checklistSnapshot.text,
      checked: checklistSnapshot.checked,
      completedAt: checklistSnapshot.completedAt,
      completedByUserId: checklistSnapshot.completedByUserId,
      updatedAt: checklistSnapshot.updatedAt,
    });
    expect(checklistPublic.page).not.toHaveProperty("workspaceId");
    expect(checklistPublic.page).not.toHaveProperty("updatedByChannel");
    expect(checklistPublic.page.stateVersion).toBe(page.stateVersion + 1);
    expect(await service.upsertShare(actor, page.id, "member-1", "editor")).toBe(shareSnapshot);
    expect(await service.removeShare(actor, page.id, "member-1")).toEqual({ removed: true });
    expect(await service.convertLegacyArchive(actor, "visible", {
      actionId: "atomic-action",
    })).toBe(conversionSnapshot);
    expect(pageReads).toBe(1);
    expect(legacyReads).toBe(1);
    expect(collectionReads).toBe(0);
    expect(checklistSnapshot.page.stateVersion).toBe(page.stateVersion + 1);
  });

  it("whitelists bounded legacy summaries and maps conversion limits to a stable 422", async () => {
    const rawArchive = {
      id: "30000000-0000-4000-8000-000000000010",
      workspaceId: actor.workspaceId,
      sourceType: "idea" as const,
      sourceId: "legacy-source",
      sourceTitle: "T".repeat(500),
      sourcePreview: "P".repeat(500),
      snapshot: { description: "x".repeat(1_000_000) },
      disposition: "converted" as const,
      convertedPageId: page.id,
      convertedActionId: "legacy-action",
      dispositionByUserId: actor.userId,
      dispositionByKind: "agent",
      dispositionByAgentJobId: "40000000-0000-4000-8000-000000000001",
      dispositionByChannel: "internal-channel",
      dispositionByTool: "internal-tool",
      dispositionAt: new Date("2026-08-12T12:00:00.000Z"),
      createdAt: new Date("2026-08-12T10:00:00.000Z"),
      updatedAt: new Date("2026-08-12T12:00:00.000Z"),
    };
    repository.getLegacy = async () => rawArchive as never;
    repository.legacy = async () => collection([rawArchive]) as never;
    repository.convertLegacy = async () => rawArchive as never;
    repository.discardLegacy = async () => ({
      ...rawArchive,
      disposition: "discarded",
      convertedPageId: null,
      convertedActionId: "discard-action",
    }) as never;
    const service = createNotesService(repository as never);

    const listed = await service.listLegacyArchive(actor);
    const converted = await service.convertLegacyArchive(actor, rawArchive.id, {
      actionId: "legacy-action",
    });
    const discarded = await service.discardLegacyArchive(actor, rawArchive.id, {
      actionId: "discard-action",
    });
    for (const summary of [listed.items[0], converted, discarded]) {
      expect(Object.keys(summary!).sort()).toEqual(legacySummaryKeys);
      expect(summary).not.toHaveProperty("snapshot");
      expect(summary).not.toHaveProperty("workspaceId");
      expect(summary).not.toHaveProperty("dispositionByUserId");
      expect(summary).not.toHaveProperty("dispositionByAgentJobId");
      expect(summary).not.toHaveProperty("dispositionByChannel");
      expect(summary).not.toHaveProperty("dispositionByTool");
      expect(new TextEncoder().encode(JSON.stringify(summary)).byteLength).toBeLessThan(5_000);
    }

    repository.convertLegacy = async () => {
      throw new Error("LEGACY_SNAPSHOT_TOO_LARGE");
    };
    await expect(service.convertLegacyArchive(actor, rawArchive.id, {
      actionId: "oversized-action",
    })).rejects.toMatchObject({
      code: "LEGACY_SNAPSHOT_TOO_LARGE",
      status: 422,
      message: "Legacy archive snapshot exceeds the conversion limit",
    });
  });

  it("returns capability-bearing full pages and owner archived summaries", async () => {
    const activeCapabilities = {
      canEdit: true,
      canManageShares: true,
      canReparent: true,
      canArchive: true,
      canChangeVisibility: true,
      canRestore: false,
    };
    const archivedCapabilities = {
      canEdit: false,
      canManageShares: false,
      canReparent: false,
      canArchive: false,
      canChangeVisibility: false,
      canRestore: true,
    };
    let archivedPagination: unknown;
    repository.createPage = async (input) => ({ ...page, ...input, ...activeCapabilities });
    repository.getPage = async (_receivedActor, pageId) => pageId === page.id
      ? { ...page, ...activeCapabilities }
      : null;
    repository.archivedPages = async (_receivedActor: NotesActor, pagination: unknown) => {
      archivedPagination = pagination;
      return collection([{ ...page, archivedAt: new Date("2026-08-10T00:00:00Z"), ...archivedCapabilities }], 10, 2);
    };
    const service = createNotesService(repository as never);

    expect(await service.createPage(actor, { title: "Page" })).toEqual(expect.objectContaining(activeCapabilities));
    expect((await service.listArchivedPages(actor, { limit: 10, offset: 2 })).items[0]).toEqual(
      expect.objectContaining(archivedCapabilities),
    );
    expect(archivedPagination).toEqual({ limit: 10, offset: 2 });
  });

  it("supports atomic legacy conversion without a pre-created target page", async () => {
    let received: unknown;
    repository.convertLegacy = async (input) => {
      received = input;
      return { id: "visible", convertedPageId: page.id, disposition: "converted" } as never;
    };
    const service = createNotesService(repository as never);
    const converted = await service.convertLegacyArchive(actor, "visible", {
      actionId: "atomic-action",
    });
    expect(converted).toEqual(expect.objectContaining({ convertedPageId: page.id }));
    expect(received).toEqual({ ...actor, archiveId: "visible", actionId: "atomic-action" });
    expect(received).not.toHaveProperty("pageId");
  });

  it("keeps workspace and user authority in the actor supplied by the adapter", async () => {
    let received: Record<string, unknown> | undefined;
    repository.createPage = async (input) => {
      received = input;
      return { ...page, ...input };
    };
    const service = createNotesService(repository as never);

    await service.createPage(actor, {
      title: "Created",
      lexicalJson: page.lexicalJson,
      parentId: null,
      visibility: "workspace",
    });

    expect(received).toEqual(
      expect.objectContaining({ workspaceId: actor.workspaceId, userId: actor.userId }),
    );
    expect(received).not.toHaveProperty("ownerUserId", "attacker");
  });

  it("allows inherited editors to change content but hides owner-only reparent authority", async () => {
    const service = createNotesService(repository as never);
    let currentTitle = page.title;
    repository.getPage = async (_actor, pageId) =>
      pageId === page.id ? { ...page, title: currentTitle, ownerUserId: "another-owner" } : null;
    repository.updatePage = async (input) => {
      currentTitle = String(input.title ?? currentTitle);
      return {
        ...page,
        ...input,
        title: currentTitle,
        ownerUserId: "another-owner",
        stateVersion: page.stateVersion + 1,
      };
    };
    let reparentCalls = 0;
    repository.reparent = async () => {
      reparentCalls += 1;
      return null as never;
    };

    expect(await service.updatePage(actor, page.id, {
      title: "Inherited editor content",
      expectedVersion: page.stateVersion,
    })).toEqual(expect.objectContaining({ title: "Inherited editor content" }));
    await expect(
      service.reparentPage(actor, page.id, {
        parentId: null,
        expectedVersion: page.stateVersion,
      }),
    ).rejects.toMatchObject({ code: "NOTE_NOT_FOUND", status: 404 });
    await expect(service.getPage(actor, "missing")).rejects.toMatchObject({
      code: "NOTE_NOT_FOUND",
      status: 404,
    });
    expect(reparentCalls).toBe(0);
  });

  it("passes workspace authority on every read and hides foreign-workspace pages", async () => {
    const receivedActors: NotesActor[] = [];
    repository.getPage = async (receivedActor, pageId) => {
      receivedActors.push(receivedActor);
      return receivedActor.workspaceId === actor.workspaceId && pageId === page.id
        ? { ...page }
        : null;
    };
    const service = createNotesService(repository as never);
    await expect(service.getPage(
      { workspaceId: "workspace-foreign", userId: actor.userId },
      page.id,
    )).rejects.toMatchObject({ code: "NOTE_NOT_FOUND", status: 404 });
    expect(receivedActors).toEqual([
      { workspaceId: "workspace-foreign", userId: actor.userId },
    ]);
  });

  it("maps stale page and checklist versions to 409 without exposing repository internals", async () => {
    const service = createNotesService(repository as never);
    await expect(
      service.updatePage(actor, page.id, {
        expectedVersion: page.stateVersion - 1,
        title: "stale",
      }),
    ).rejects.toMatchObject({ code: "NOTE_VERSION_CONFLICT", status: 409 });
    await expect(
      service.updateChecklistItem(actor, page.id, "20000000-0000-4000-8000-000000000001", {
        checked: true,
        expectedVersion: page.stateVersion - 1,
      }),
    ).rejects.toMatchObject({ code: "NOTE_VERSION_CONFLICT", status: 409 });
  });

  it("classifies owner CAS losers through the archived owner view without disclosing pages to editors", async () => {
    const archivedWinner = {
      ...page,
      stateVersion: page.stateVersion + 1,
      archivedAt: new Date("2026-08-12T13:00:00.000Z"),
    };
    const expectOwnerConflict = async (
      operation: (service: ReturnType<typeof createNotesService>) => Promise<unknown>,
      configure: (candidate: ReturnType<typeof makeRepository>) => void,
    ) => {
      const candidate = makeRepository();
      let activeReads = 0;
      let archivedOwnerReads = 0;
      candidate.getPage = async () => {
        activeReads += 1;
        return activeReads === 1 ? page as never : null;
      };
      candidate.getOwnedPageIncludingArchived = async () => {
        archivedOwnerReads += 1;
        return archivedWinner as never;
      };
      configure(candidate);

      await expect(operation(createNotesService(candidate as never))).rejects.toMatchObject({
        code: "NOTE_VERSION_CONFLICT",
        status: 409,
      });
      expect(activeReads).toBe(1);
      expect(archivedOwnerReads).toBe(1);
    };

    await expectOwnerConflict(
      (service) => service.archivePage(actor, page.id, { expectedVersion: page.stateVersion }),
      (candidate) => { candidate.updatePage = async () => null as never; },
    );
    await expectOwnerConflict(
      (service) => service.reparentPage(actor, page.id, {
        expectedVersion: page.stateVersion,
        parentId: "10000000-0000-4000-8000-000000000002",
      }),
      (candidate) => { candidate.reparent = async () => null as never; },
    );
    await expectOwnerConflict(
      (service) => service.updatePage(actor, page.id, {
        expectedVersion: page.stateVersion,
        visibility: "workspace",
      }),
      (candidate) => { candidate.updatePage = async () => null as never; },
    );
    await expectOwnerConflict(
      (service) => service.updateChecklistItem(
        actor,
        page.id,
        "20000000-0000-4000-8000-000000000001",
        { expectedVersion: page.stateVersion, checked: true },
      ),
      (candidate) => { candidate.updateChecklistItem = async () => null as never; },
    );

    const editorRepository = makeRepository();
    let editorReads = 0;
    let editorOwnerReads = 0;
    editorRepository.getPage = async () => {
      editorReads += 1;
      return editorReads === 1 ? { ...page, ownerUserId: "different-owner" } as never : null;
    };
    editorRepository.getOwnedPageIncludingArchived = async () => {
      editorOwnerReads += 1;
      return archivedWinner as never;
    };
    editorRepository.updatePage = async () => null as never;
    await expect(createNotesService(editorRepository as never).updatePage(actor, page.id, {
      expectedVersion: page.stateVersion,
      title: "editor loser",
    })).rejects.toMatchObject({ code: "NOTE_NOT_FOUND", status: 404 });
    expect(editorReads).toBe(2);
    expect(editorOwnerReads).toBe(0);
  });

  it("uses the owner-only archived read to restore with CAS semantics", async () => {
    let updateInput: Record<string, unknown> | undefined;
    repository.updatePage = async (input) => {
      updateInput = input;
      return { ...page, ...input, stateVersion: 4 };
    };
    const service = createNotesService(repository as never);
    await service.restorePage(actor, page.id, { expectedVersion: page.stateVersion });
    expect(updateInput).toEqual(
      expect.objectContaining({
        pageId: page.id,
        expectedStateVersion: page.stateVersion,
        archivedAt: null,
      }),
    );
  });

  it("rejects malformed explicit month/day values before repository access", async () => {
    let calls = 0;
    repository.listDailyByMonth = async () => {
      calls += 1;
      return collection([]);
    };
    repository.getOrCreateDaily = async () => {
      calls += 1;
      return page as never;
    };
    repository.listDailyCarryover = async () => {
      calls += 1;
      return collection([]);
    };
    const service = createNotesService(repository as never);

    await expect(service.listAgendaMonth(actor, "2026-13")).rejects.toMatchObject({
      code: "INVALID_MONTH",
      status: 400,
    });
    await expect(service.listAgendaMonth(actor, "0000-12")).rejects.toMatchObject({
      code: "INVALID_MONTH",
      status: 400,
    });
    await expect(service.getOrCreateAgendaDay(actor, "2026-02-30")).rejects.toMatchObject({
      code: "INVALID_DATE",
      status: 400,
    });
    await expect(service.listAgendaCarryover(actor, "11/08/2026")).rejects.toMatchObject({
      code: "INVALID_DATE",
      status: 400,
    });
    expect(calls).toBe(0);
  });

  it("enforces bounded search at the shared service boundary", async () => {
    let receivedPagination: unknown;
    repository.search = async (_actor: NotesActor, _query: string, pagination: { limit?: number; offset?: number }) => {
      receivedPagination = pagination;
      return collection([{ ...page }], pagination?.limit, pagination?.offset);
    };
    const service = createNotesService(repository as never);

    await service.searchPages(actor, { query: "  roadmap  ", limit: 100, offset: 12 });
    expect(receivedPagination).toEqual({ limit: 100, offset: 12 });
    await expect(service.searchPages(actor, { query: "roadmap", limit: 500 })).rejects.toMatchObject({
      code: "INVALID_PAGINATION",
      status: 422,
    });
    await expect(service.searchPages(actor, { query: "   ", limit: 20 })).rejects.toMatchObject({
      code: "INVALID_QUERY",
      status: 422,
    });
    await expect(service.searchPages(actor, { query: "x".repeat(201), limit: 20 })).rejects.toBeInstanceOf(
      NotesServiceError,
    );
  });

  it("defends the PostgreSQL int4 position boundary before repository access", async () => {
    let repositoryCalls = 0;
    repository.createPage = async () => {
      repositoryCalls += 1;
      return page as never;
    };
    repository.getPage = async () => {
      repositoryCalls += 1;
      return page as never;
    };
    repository.updatePage = async () => {
      repositoryCalls += 1;
      return page as never;
    };
    const service = createNotesService(repository as never);

    await expect(service.createPage(actor, { position: 2_147_483_648 })).rejects.toMatchObject({
      code: "INVALID_POSITION",
      status: 422,
    });
    await expect(service.updatePage(actor, page.id, {
      expectedVersion: page.stateVersion,
      position: 2_147_483_648,
    })).rejects.toMatchObject({ code: "INVALID_POSITION", status: 422 });
    expect(repositoryCalls).toBe(0);
  });

  it("filters legacy archive dispositions without mutating canonical sources", async () => {
    let receivedOptions: unknown;
    repository.legacy = async (_actor: NotesActor, options: { disposition?: string; limit?: number; offset?: number }) => {
      receivedOptions = options;
      return collection([
        { id: "converted", disposition: "converted" },
        { id: "discarded", disposition: "discarded" },
      ], options?.limit, options?.offset);
    };
    const service = createNotesService(repository as never);
    expect((await service.listLegacyArchive(actor, { disposition: "terminal", limit: 2 })).items.map((item: any) => item.id)).toEqual([
      "converted",
      "discarded",
    ]);
    expect(receivedOptions).toEqual({ disposition: "terminal", limit: 2, offset: 0 });
  });

  it("hides inaccessible legacy archive actions before attempting a mutation", async () => {
    let convertCalls = 0;
    let discardCalls = 0;
    repository.convertLegacy = async (input) => {
      convertCalls += 1;
      return { id: "legacy-1", ...input };
    };
    repository.discardLegacy = async (input) => {
      discardCalls += 1;
      return { id: "legacy-1", ...input };
    };
    const service = createNotesService(repository as never);

    await expect(service.convertLegacyArchive(actor, "foreign", {
      pageId: page.id,
      actionId: "convert-action",
    })).rejects.toMatchObject({ code: "NOTE_NOT_FOUND", status: 404 });
    await expect(service.discardLegacyArchive(actor, "foreign", {
      actionId: "discard-action",
    })).rejects.toMatchObject({ code: "NOTE_NOT_FOUND", status: 404 });
    expect(convertCalls).toBe(0);
    expect(discardCalls).toBe(0);

    repository.convertLegacy = async () => {
      throw new Error("LEGACY_REPLAY_MISMATCH");
    };
    await expect(service.convertLegacyArchive(actor, "visible", {
      pageId: page.id,
      actionId: "conflicting-action",
    })).rejects.toMatchObject({ code: "LEGACY_REPLAY_CONFLICT", status: 409 });
  });

  it("sanitizes unknown repository failures while retaining stable domain mappings", async () => {
    repository.pageTree = async () => {
      throw new Error('SQL: select * from note_pages where secret = "credential"');
    };
    const service = createNotesService(repository as never);
    await expect(service.listPages(actor)).rejects.toMatchObject({
      code: "NOTES_INTERNAL_ERROR",
      status: 500,
      message: "Notes operation failed",
    });

    repository.createPage = async () => {
      throw new Error("Invalid Lexical document: root is too large");
    };
    await expect(
      service.createPage(actor, { title: "Bad", lexicalJson: null as never }),
    ).rejects.toMatchObject({ code: "INVALID_CONTENT", status: 422 });
  });
});
