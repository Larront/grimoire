import { describe, it, expect, vi } from "vitest";
import { pendingSaves } from "$lib/stores/pending-saves";

describe("pendingSaves", () => {
  it("flushAll awaits every registered flush", async () => {
    let resolveA!: () => void;
    const done: string[] = [];
    const a = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveA = () => {
            done.push("a");
            res();
          };
        }),
    );
    const b = vi.fn(async () => {
      done.push("b");
    });

    const offA = pendingSaves.register(a);
    const offB = pendingSaves.register(b);

    const all = pendingSaves.flushAll();
    let settled = false;
    all.then(() => (settled = true));

    await Promise.resolve();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    expect(settled).toBe(false); // still waiting on a

    resolveA();
    await all;
    expect(done).toContain("a");
    expect(done).toContain("b");

    offA();
    offB();
  });

  it("never rejects even when a flush fails", async () => {
    const bad = vi.fn(async () => {
      throw new Error("disk full");
    });
    const good = vi.fn(async () => {});
    const offBad = pendingSaves.register(bad);
    const offGood = pendingSaves.register(good);

    await expect(pendingSaves.flushAll()).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledOnce();

    offBad();
    offGood();
  });

  it("unregistered flushes are not called", async () => {
    const fn = vi.fn(async () => {});
    const off = pendingSaves.register(fn);
    off();

    await pendingSaves.flushAll();
    expect(fn).not.toHaveBeenCalled();
  });
});
