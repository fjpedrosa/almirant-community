import { TypedEventBus } from "./event-bus";
import {
  SessionState,
  canTransitionSessionState,
  isTerminalSessionState,
} from "./state";

const DEFAULT_STARTUP_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_STAGNATION_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000;

export type SessionStateTrigger =
  | "start_requested"
  | "startup_succeeded"
  | "startup_timeout"
  | "output_received"
  | "stagnation_timeout"
  | "max_duration_timeout"
  | "completed"
  | "error"
  | "cancel_requested";

export type SessionTransitionEvent = {
  from: SessionState;
  to: SessionState;
  trigger: SessionStateTrigger;
  at: string;
  metadata?: Record<string, unknown>;
};

export type SessionTimerEvent = {
  timer: "startup" | "stagnation" | "max_duration";
  state: SessionState;
  at: string;
};

export type SessionStateMachineEvents = {
  transition: SessionTransitionEvent;
  timerFired: SessionTimerEvent;
  stale: {
    state: SessionState.STAGNANT;
    at: string;
  };
  failed: {
    state: SessionState.FAILED;
    reason: string;
    at: string;
  };
};

export type SessionStateMachineOptions = {
  startupTimeoutMs?: number;
  stagnationTimeoutMs?: number;
  maxDurationMs?: number;
  eventBus?: TypedEventBus<SessionStateMachineEvents>;
  now?: () => Date;
};

type TimerName = "startup" | "stagnation" | "max_duration";

export class SessionStateMachine {
  private state: SessionState = SessionState.PENDING;
  private readonly startupTimeoutMs: number;
  private readonly stagnationTimeoutMs: number;
  private readonly maxDurationMs: number;
  private readonly eventBus: TypedEventBus<SessionStateMachineEvents>;
  private readonly now: () => Date;

  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private stagnationTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;

  private startedAt: Date | null = null;
  private updatedAt: Date = new Date();

  constructor(options: SessionStateMachineOptions = {}) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.stagnationTimeoutMs =
      options.stagnationTimeoutMs ?? DEFAULT_STAGNATION_TIMEOUT_MS;
    this.maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    this.eventBus = options.eventBus ?? new TypedEventBus<SessionStateMachineEvents>();
    this.now = options.now ?? (() => new Date());
  }

  public getEventBus(): TypedEventBus<SessionStateMachineEvents> {
    return this.eventBus;
  }

  public getState(): SessionState {
    return this.state;
  }

  public start(): void {
    this.transition(SessionState.STARTING, "start_requested");
    this.setTimer("startup");
  }

  public markStarted(): void {
    this.startedAt = this.now();
    this.transition(SessionState.ACTIVE, "startup_succeeded");
    this.clearTimer("startup");
    this.setTimer("stagnation");
    this.setTimer("max_duration");
  }

  public onOutputReceived(): void {
    if (this.state === SessionState.STAGNANT) {
      this.transition(SessionState.ACTIVE, "output_received");
    }

    if (this.state === SessionState.ACTIVE) {
      this.setTimer("stagnation");
    }
  }

  public markDone(metadata?: Record<string, unknown>): void {
    this.transition(SessionState.COMPLETED, "completed", metadata);
    this.clearAllTimers();
  }

  public fail(reason: string, metadata?: Record<string, unknown>): void {
    if (isTerminalSessionState(this.state)) return;
    this.transition(SessionState.FAILED, "error", {
      ...metadata,
      reason,
    });
    this.clearAllTimers();
    void this.eventBus.emit("failed", {
      state: SessionState.FAILED,
      reason,
      at: this.now().toISOString(),
    });
  }

  public cancel(metadata?: Record<string, unknown>): void {
    this.transition(SessionState.CANCELLED, "cancel_requested", metadata);
    this.clearAllTimers();
  }

  public toJSON(): Record<string, unknown> {
    return {
      state: this.state,
      startupTimeoutMs: this.startupTimeoutMs,
      stagnationTimeoutMs: this.stagnationTimeoutMs,
      maxDurationMs: this.maxDurationMs,
      startedAt: this.startedAt?.toISOString() ?? null,
      updatedAt: this.updatedAt.toISOString(),
    };
  }

  private setTimer(timerName: TimerName): void {
    this.clearTimer(timerName);

    const timeout =
      timerName === "startup"
        ? this.startupTimeoutMs
        : timerName === "stagnation"
          ? this.stagnationTimeoutMs
          : this.maxDurationMs;

    const handler = (): void => {
      void this.eventBus.emit("timerFired", {
        timer: timerName,
        state: this.state,
        at: this.now().toISOString(),
      });

      if (isTerminalSessionState(this.state)) return;

      if (timerName === "startup" && this.state === SessionState.STARTING) {
        this.fail("startup_timeout", { timer: timerName });
        return;
      }

      if (timerName === "stagnation" && this.state === SessionState.ACTIVE) {
        this.transition(SessionState.STAGNANT, "stagnation_timeout", {
          timer: timerName,
        });
        void this.eventBus.emit("stale", {
          state: SessionState.STAGNANT,
          at: this.now().toISOString(),
        });
        return;
      }

      if (timerName === "max_duration") {
        this.fail("max_duration_timeout", { timer: timerName });
      }
    };

    const handle = setTimeout(handler, timeout);
    if (timerName === "startup") this.startupTimer = handle;
    if (timerName === "stagnation") this.stagnationTimer = handle;
    if (timerName === "max_duration") this.maxDurationTimer = handle;
  }

  private clearTimer(timerName: TimerName): void {
    const handle =
      timerName === "startup"
        ? this.startupTimer
        : timerName === "stagnation"
          ? this.stagnationTimer
          : this.maxDurationTimer;

    if (handle) {
      clearTimeout(handle);
    }

    if (timerName === "startup") this.startupTimer = null;
    if (timerName === "stagnation") this.stagnationTimer = null;
    if (timerName === "max_duration") this.maxDurationTimer = null;
  }

  private clearAllTimers(): void {
    this.clearTimer("startup");
    this.clearTimer("stagnation");
    this.clearTimer("max_duration");
  }

  private transition(
    to: SessionState,
    trigger: SessionStateTrigger,
    metadata?: Record<string, unknown>
  ): void {
    if (this.state === to) return;

    if (!canTransitionSessionState(this.state, to)) {
      throw new Error(`Invalid SessionState transition: ${this.state} -> ${to}`);
    }

    const from = this.state;
    this.state = to;
    this.updatedAt = this.now();

    void this.eventBus.emit("transition", {
      from,
      to,
      trigger,
      at: this.updatedAt.toISOString(),
      metadata,
    });
  }
}
