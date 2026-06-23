export type EventMap = Record<string, unknown>;

type Listener<T> = (payload: T) => void | Promise<void>;

type ListenerSet<TEvents extends EventMap> = {
  [K in keyof TEvents]?: Set<Listener<TEvents[K]>>;
};

export class TypedEventBus<TEvents extends EventMap> {
  private readonly listeners: ListenerSet<TEvents> = {};

  public on<K extends keyof TEvents>(
    eventName: K,
    listener: Listener<TEvents[K]>
  ): () => void {
    const current = this.listeners[eventName] ?? new Set<Listener<TEvents[K]>>();
    current.add(listener);
    this.listeners[eventName] = current;

    return () => {
      this.off(eventName, listener);
    };
  }

  public once<K extends keyof TEvents>(
    eventName: K,
    listener: Listener<TEvents[K]>
  ): () => void {
    const off = this.on(eventName, async (payload) => {
      off();
      await listener(payload);
    });

    return off;
  }

  public off<K extends keyof TEvents>(
    eventName: K,
    listener: Listener<TEvents[K]>
  ): void {
    const set = this.listeners[eventName];
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      delete this.listeners[eventName];
    }
  }

  public async emit<K extends keyof TEvents>(
    eventName: K,
    payload: TEvents[K]
  ): Promise<void> {
    const set = this.listeners[eventName];
    if (!set || set.size === 0) return;

    const listeners = [...set];
    for (const listener of listeners) {
      await listener(payload);
    }
  }

  public listenerCount<K extends keyof TEvents>(eventName: K): number {
    return this.listeners[eventName]?.size ?? 0;
  }
}
