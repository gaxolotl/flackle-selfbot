/**
 * Serialises requests and enforces a minimum gap between them. Flackle does not
 * publish rate limits, so the defaults are deliberately conservative; a 429
 * makes the limiter pause every queued request until the retry window passes.
 */
export class RateLimiter {
  readonly #intervalMs: number;
  #chain: Promise<unknown> = Promise.resolve();
  #last = 0;
  #blockedUntil = 0;

  constructor(intervalMs = 50) {
    this.#intervalMs = Math.max(0, intervalMs);
  }

  get intervalMs(): number {
    return this.#intervalMs;
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const now = Date.now();
      const wait = Math.max(this.#blockedUntil - now, this.#last + this.#intervalMs - now, 0);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      try {
        return await task();
      } finally {
        this.#last = Date.now();
      }
    };

    const next = this.#chain.then(run, run);
    // Keep the chain alive even when a task rejects.
    this.#chain = next.catch(() => undefined);
    return next;
  }

  /** Pauses the queue for `ms` milliseconds (used for 429 responses). */
  blockFor(ms: number): void {
    this.#blockedUntil = Math.max(this.#blockedUntil, Date.now() + Math.max(0, ms));
  }
}
