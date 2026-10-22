type Listener<T> = (payload: T) => void;

/**
 * Minimal typed event emitter. `on` returns an unsubscribe function as well as
 * the emitter, so both patterns work:
 *
 * ```ts
 * const off = client.on("messageCreate", handler);
 * client.on("messageCreate", handler);
 * ```
 */
export class TypedEmitter<Events extends object> {
  readonly #listeners = new Map<keyof Events, Set<Listener<any>>>();

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    let set = this.#listeners.get(event);
    if (!set) {
      set = new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    const wrapper: Listener<Events[K]> = (payload) => {
      this.off(event, wrapper);
      listener(payload);
    };
    return this.on(event, wrapper);
  }

  off<K extends keyof Events>(event: K, listener: Listener<Events[K]>): this {
    this.#listeners.get(event)?.delete(listener);
    return this;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): boolean {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return false;
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch (error) {
        // A broken listener must not take down the gateway reader.
        console.error("[flackle-selfbot] event listener threw:", error);
      }
    }
    return true;
  }

  listenerCount(event: keyof Events): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  removeAllListeners(event?: keyof Events): this {
    if (event === undefined) this.#listeners.clear();
    else this.#listeners.delete(event);
    return this;
  }
}
