import { describe, expect, test } from "bun:test";
import { RateLimiter } from "../src/rate-limiter.ts";

describe("RateLimiter", () => {
  test("serialises tasks", async () => {
    const limiter = new RateLimiter(10);
    const order: number[] = [];
    await Promise.all([
      limiter.schedule(async () => order.push(1)),
      limiter.schedule(async () => order.push(2)),
      limiter.schedule(async () => order.push(3)),
    ]);
    expect(order).toEqual([1, 2, 3]);
  });

  test("keeps running after a rejection", async () => {
    const limiter = new RateLimiter(1);
    await expect(limiter.schedule(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await limiter.schedule(async () => "ok")).toBe("ok");
  });

  test("honours a block", async () => {
    const limiter = new RateLimiter(0);
    const start = Date.now();
    limiter.blockFor(40);
    await limiter.schedule(async () => undefined);
    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
  });
});
