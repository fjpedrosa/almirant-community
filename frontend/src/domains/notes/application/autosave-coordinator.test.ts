import { describe, expect, it } from "bun:test";
import { NotesAutosaveCoordinator, type AutosaveState, type AutosaveStatus } from "./autosave-coordinator";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe("Notes autosave coordinator", () => {
  it("keeps one request in flight, saves only the newest queued snapshot, and advances CAS versions", async () => {
    const first = deferred<{ stateVersion: number }>();
    const calls: Array<{ title: string; expectedVersion: number }> = [];
    const statuses: AutosaveStatus[] = [];
    const coordinator = new NotesAutosaveCoordinator<{ title: string }>({
      initialVersion: 7,
      delayMs: 2_000,
      onStatus: (state) => statuses.push(state.status),
      save: async (draft, expectedVersion) => {
        calls.push({ ...draft, expectedVersion });
        if (calls.length === 1) return first.promise;
        return { stateVersion: expectedVersion + 1 };
      },
    });

    coordinator.queue({ title: "first" });
    const flushing = coordinator.flush();
    coordinator.queue({ title: "obsolete" });
    coordinator.queue({ title: "newest" });
    await Promise.resolve();
    expect(calls).toEqual([{ title: "first", expectedVersion: 7 }]);
    first.resolve({ stateVersion: 8 });
    await flushing;

    expect(calls).toEqual([
      { title: "first", expectedVersion: 7 },
      { title: "newest", expectedVersion: 8 },
    ]);
    expect(coordinator.version).toBe(9);
    expect(coordinator.state.status).toBe("saved");
    expect(statuses).toContain("saving");
  });

  it("pauses on a version conflict and preserves the exact local draft", async () => {
    const conflict = Object.assign(new Error("conflict"), { code: "NOTE_VERSION_CONFLICT" });
    const coordinator = new NotesAutosaveCoordinator<{ title: string }>({
      initialVersion: 3,
      delayMs: 2_000,
      save: async () => { throw conflict; },
      isConflict: (error) => (error as { code?: string }).code === "NOTE_VERSION_CONFLICT",
    });
    coordinator.queue({ title: "Local draft must survive" });
    await expect(coordinator.flush()).rejects.toBe(conflict);
    expect(coordinator.state).toEqual(expect.objectContaining({
      status: "conflict",
      localDraft: { title: "Local draft must survive" },
    }));
    expect(coordinator.version).toBe(3);
    expect(() => coordinator.queue({ title: "blocked" })).toThrow("AUTOSAVE_PAUSED");
  });

  it("flushes pending content before serializing a checklist or owner command", async () => {
    const events: string[] = [];
    const coordinator = new NotesAutosaveCoordinator<{ title: string }>({
      initialVersion: 1,
      delayMs: 2_000,
      save: async (_draft, expectedVersion) => {
        events.push(`save:${expectedVersion}`);
        return { stateVersion: expectedVersion + 1 };
      },
    });
    coordinator.queue({ title: "draft" });
    const result = await coordinator.serialize(async (expectedVersion) => {
      events.push(`command:${expectedVersion}`);
      return { stateVersion: expectedVersion + 1, value: "done" };
    });
    expect(events).toEqual(["save:1", "command:2"]);
    expect(result.value).toBe("done");
    expect(coordinator.version).toBe(3);
  });

  it("does not replace a newer local snapshot when an older in-flight save fails", async () => {
    const first = deferred<{ stateVersion: number }>();
    const failure = new Error("temporary outage");
    const calls: Array<{ title: string; expectedVersion: number }> = [];
    const coordinator = new NotesAutosaveCoordinator<{ title: string }>({
      initialVersion: 4,
      delayMs: 2_000,
      save: async (draft, expectedVersion) => {
        calls.push({ ...draft, expectedVersion });
        if (calls.length === 1) return first.promise;
        throw failure;
      },
    });

    coordinator.queue({ title: "old" });
    const flushing = coordinator.flush();
    coordinator.queue({ title: "newest" });
    first.reject(failure);
    await expect(flushing).rejects.toBe(failure);

    expect(coordinator.state.localDraft).toEqual({ title: "newest" });
    expect(coordinator.state.status).toBe("error");
  });

  it("serializes commands behind one FIFO mutex and preserves the draft on command failure", async () => {
    const first = deferred<{ stateVersion: number; value: string }>();
    const events: string[] = [];
    const coordinator = new NotesAutosaveCoordinator<{ title: string }>({
      initialVersion: 2,
      delayMs: 2_000,
      save: async (_draft, expectedVersion) => ({ stateVersion: expectedVersion + 1 }),
    });
    coordinator.queue({ title: "draft" });
    const command = coordinator.serialize(async (expectedVersion) => {
      events.push(`first:${expectedVersion}`);
      return first.promise;
    });
    const second = coordinator.serialize(async (expectedVersion) => {
      events.push(`second:${expectedVersion}`);
      return { stateVersion: expectedVersion + 1, value: "second" };
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["first:3"]);
    first.resolve({ stateVersion: 4, value: "first" });
    await expect(command).resolves.toMatchObject({ value: "first" });
    await expect(second).resolves.toMatchObject({ value: "second" });
    expect(events).toEqual(["first:3", "second:4"]);
    expect(coordinator.version).toBe(5);
  });

  it("never starts a later command while an earlier command is still running", async () => {
    const first = deferred<{ stateVersion: number }>();
    let active = 0;
    let maxActive = 0;
    const coordinator = new NotesAutosaveCoordinator<never>({
      initialVersion: 1,
      save: async () => ({ stateVersion: 2 }),
    });
    const run = (version: number) => coordinator.serialize(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (version === 1) await first.promise;
      active -= 1;
      return { stateVersion: version + 1 };
    });
    const firstCommand = run(1);
    const secondCommand = run(2);
    const thirdCommand = run(3);
    await Promise.resolve();
    first.resolve({ stateVersion: 2 });
    await Promise.all([firstCommand, secondCommand, thirdCommand]);
    expect(maxActive).toBe(1);
  });

  it("keeps a draft queued while a versioned command is in flight", async () => {
    let release!: () => void;
    const commandStarted = Promise.withResolvers<void>();
    const commandRelease = new Promise<void>((resolve) => { release = resolve; });
    const states: AutosaveState<string>[] = [];
    const coordinator = new NotesAutosaveCoordinator<string>({
      initialVersion: 4,
      delayMs: 1_000,
      save: async (draft, expectedVersion) => ({ stateVersion: expectedVersion + 1 }),
      onStatus: (state) => states.push(state),
    });
    const command = coordinator.serialize(async (expectedVersion) => {
      commandStarted.resolve();
      await commandRelease;
      return { stateVersion: expectedVersion + 1 };
    });
    await commandStarted.promise;
    coordinator.queue("newer draft");
    release();
    await command;
    expect(states.at(-1)).toMatchObject({ status: "dirty", localDraft: "newer draft" });
    await coordinator.flush();
    expect(states.at(-1)).toMatchObject({ status: "saved", localDraft: null });
    expect(coordinator.version).toBe(6);
  });

  it("requires an explicit flushAndDispose when dirty work remains", async () => {
    const coordinator = new NotesAutosaveCoordinator<{ title: string }>({
      initialVersion: 1,
      delayMs: 2_000,
      save: async (_draft, expectedVersion) => ({ stateVersion: expectedVersion + 1 }),
    });
    coordinator.queue({ title: "keep me" });
    expect(() => coordinator.dispose()).toThrow("FLUSH_REQUIRED");
    await coordinator.flushAndDispose();
    expect(coordinator.state.status).toBe("saved");
  });
});
