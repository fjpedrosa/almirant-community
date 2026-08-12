export type AutosaveStatus = "saved" | "dirty" | "saving" | "error" | "conflict";

export type AutosaveState<Draft> = {
  status: AutosaveStatus;
  localDraft: Draft | null;
  error: unknown | null;
};

type Versioned = { stateVersion: number };

type Options<Draft> = {
  initialVersion: number;
  delayMs?: number;
  save: (draft: Draft, expectedVersion: number) => Promise<Versioned>;
  isConflict?: (error: unknown) => boolean;
  onStatus?: (state: AutosaveState<Draft>) => void;
};

export class NotesAutosaveCoordinator<Draft> {
  private acknowledgedVersion: number;
  private readonly delayMs: number;
  private readonly saveDraft: Options<Draft>["save"];
  private readonly isConflict: NonNullable<Options<Draft>["isConflict"]>;
  private readonly onStatus?: Options<Draft>["onStatus"];
  private queuedDraft: Draft | null = null;
  private lastLocalDraft: Draft | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private drainPromise: Promise<void> | null = null;
  private operationTail: Promise<void> = Promise.resolve();
  private operationQueue: Array<{ operation: () => Promise<unknown>; resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
  private operationActive = false;
  private paused = false;
  private disposed = false;
  private currentState: AutosaveState<Draft> = { status: "saved", localDraft: null, error: null };

  constructor(options: Options<Draft>) {
    this.acknowledgedVersion = options.initialVersion;
    this.delayMs = options.delayMs ?? 2_000;
    this.saveDraft = options.save;
    this.isConflict = options.isConflict ?? (() => false);
    this.onStatus = options.onStatus;
  }

  get version(): number {
    return this.acknowledgedVersion;
  }

  get state(): AutosaveState<Draft> {
    return this.currentState;
  }

  get hasPendingChanges(): boolean {
    return this.currentState.status === "dirty" || this.currentState.status === "saving";
  }

  get isBusy(): boolean {
    return this.operationActive || this.operationQueue.length > 0 || this.drainPromise !== null;
  }

  queue(draft: Draft): void {
    if (this.disposed) throw new Error("AUTOSAVE_DISPOSED");
    if (this.paused) throw new Error("AUTOSAVE_PAUSED");
    this.queuedDraft = draft;
    this.lastLocalDraft = draft;
    this.setState({ status: "dirty", localDraft: draft, error: null });
    if (!this.drainPromise) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush().catch(() => undefined);
      }, this.delayMs);
    }
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.drainPromise) return this.drainPromise;
    if (!this.queuedDraft) return this.operationTail;
    this.drainPromise = this.enqueue(() => this.drain()).finally(() => {
      this.drainPromise = null;
    });
    return this.drainPromise;
  }

  async serialize<Result extends Versioned>(
    command: (expectedVersion: number) => Promise<Result>,
  ): Promise<Result> {
    return this.enqueue(async () => {
      await this.drain();
      if (this.disposed) throw new Error("AUTOSAVE_DISPOSED");
      if (this.paused) throw new Error("AUTOSAVE_PAUSED");
      try {
        const result = await command(this.acknowledgedVersion);
        this.acknowledgedVersion = result.stateVersion;
        const queuedDraft = this.queuedDraft;
        this.lastLocalDraft = queuedDraft;
        this.setState(queuedDraft
          ? { status: "dirty", localDraft: queuedDraft, error: null }
          : { status: "saved", localDraft: null, error: null });
        return result;
      } catch (error) {
        this.paused = this.isConflict(error);
        this.setState({
          status: this.paused ? "conflict" : "error",
          localDraft: this.lastLocalDraft,
          error,
        });
        throw error;
      }
    });
  }

  resumeAtVersion(version: number, discardLocalDraft = true): void {
    this.disposed = false;
    this.paused = false;
    this.acknowledgedVersion = version;
    this.queuedDraft = discardLocalDraft ? null : this.lastLocalDraft;
    this.setState({
      status: this.queuedDraft ? "dirty" : "saved",
      localDraft: this.queuedDraft,
      error: null,
    });
  }

  dispose(): void {
    if (this.hasPendingChanges || this.queuedDraft || this.drainPromise) throw new Error("FLUSH_REQUIRED");
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.disposed = true;
  }

  async flushAndDispose(): Promise<void> {
    await this.flush();
    await this.operationTail;
    this.dispose();
  }

  private async drain(): Promise<void> {
    while (this.queuedDraft) {
      const draft = this.queuedDraft;
      this.queuedDraft = null;
      this.setState({ status: "saving", localDraft: draft, error: null });
      try {
        const result = await this.saveDraft(draft, this.acknowledgedVersion);
        this.acknowledgedVersion = result.stateVersion;
      } catch (error) {
        this.paused = this.isConflict(error);
        if (!this.queuedDraft) this.queuedDraft = draft;
        this.setState({
          status: this.paused ? "conflict" : "error",
          localDraft: this.queuedDraft,
          error,
        });
        throw error;
      }
    }
    this.setState({ status: "saved", localDraft: null, error: null });
  }

  private setState(state: AutosaveState<Draft>): void {
    this.currentState = state;
    this.onStatus?.(state);
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    let resolve!: (value: Result) => void;
    let reject!: (error: unknown) => void;
    const run = new Promise<Result>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    this.operationQueue.push({ operation, resolve: resolve as (value: unknown) => void, reject });
    const completion = this.operationTail.then(() => run, () => run);
    this.operationTail = completion.then(() => undefined, () => undefined);
    this.pumpOperations();
    return run;
  }

  private pumpOperations(): void {
    if (this.operationActive) return;
    const task = this.operationQueue.shift();
    if (!task) return;
    this.operationActive = true;
    let result: Promise<unknown>;
    try {
      result = task.operation();
    } catch (error) {
      result = Promise.reject(error);
    }
    result.then(task.resolve, task.reject).then(
      () => { this.operationActive = false; this.pumpOperations(); },
      () => { this.operationActive = false; this.pumpOperations(); },
    );
  }
}
