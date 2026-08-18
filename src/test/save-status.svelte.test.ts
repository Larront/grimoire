// Tests for the save-status machine shared by every Details Source (#210).
//
// The two defects that fell out of hand-rolling it three times are the subject
// here: the flash timer that was never cleared on teardown (so a source torn
// down within 1.5s of a save wrote $state after its owner was gone), and the
// retry contract, which nothing stated.
import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { createSaveStatus } from "$lib/details/save-status.svelte";
import type { SaveStatusMachine } from "$lib/details/save-status.svelte";

let cleanup: (() => void) | null = null;

function mount(): SaveStatusMachine {
  let machine!: SaveStatusMachine;
  cleanup = $effect.root(() => {
    machine = createSaveStatus();
  });
  flushSync();
  return machine;
}

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
});

describe("save-status machine — reporting", () => {
  it("flashes 'saved' after a successful attempt, then returns to idle", async () => {
    vi.useFakeTimers();
    const machine = mount();
    expect(machine.status).toBe("idle");

    await machine.run(async () => {});
    expect(machine.status).toBe("saved");

    vi.advanceTimersByTime(1500);
    expect(machine.status).toBe("idle");
  });

  it("reports a failed attempt as 'error' without rejecting", async () => {
    const machine = mount();
    // The contract PinDetails' bare `onblur` depends on: awaiting a save can
    // never produce an unhandled rejection (#203).
    await expect(
      machine.run(async () => {
        throw new Error("write failed");
      }),
    ).resolves.toBeUndefined();
    expect(machine.status).toBe("error");
  });

  it("clears a pending error flash when the next attempt begins", async () => {
    vi.useFakeTimers();
    const machine = mount();
    await machine.run(async () => {});
    expect(machine.status).toBe("saved");

    const pending = machine.run(() => new Promise<void>(() => {}));
    expect(machine.status).toBe("idle");
    // The first save's flash timer must not fire into the second save.
    expect(vi.getTimerCount()).toBe(0);
    void pending;
  });
});

describe("save-status machine — retry contract", () => {
  it("replays the attempt that failed, over the values it captured", async () => {
    const machine = mount();
    const seen: string[] = [];
    let failing = true;
    const attempt = (value: string) => async () => {
      seen.push(value);
      if (failing) throw new Error("nope");
    };

    await machine.run(attempt("first"));
    expect(machine.status).toBe("error");

    // The body has moved on since — retry still sends what failed, not this.
    failing = false;
    await machine.retry();
    expect(seen).toEqual(["first", "first"]);
    expect(machine.status).toBe("saved");
  });

  it("forgets the failed attempt once one succeeds", async () => {
    const machine = mount();
    let calls = 0;
    await machine.run(async () => {
      calls++;
      throw new Error("nope");
    });
    await machine.run(async () => { calls++; });
    expect(machine.status).toBe("saved");

    await machine.retry();
    expect(calls).toBe(2); // no replay — nothing is outstanding
  });

  it("reset() drops the status and the outstanding attempt", async () => {
    const machine = mount();
    let calls = 0;
    await machine.run(async () => {
      calls++;
      throw new Error("nope");
    });
    expect(machine.status).toBe("error");

    machine.reset();
    expect(machine.status).toBe("idle");
    await machine.retry();
    expect(calls).toBe(1);
  });
});

describe("save-status machine — teardown", () => {
  it("clears the flash timer, so nothing is written after the owner is gone", async () => {
    vi.useFakeTimers();
    const machine = mount();
    await machine.run(async () => {});
    expect(machine.status).toBe("saved");
    expect(vi.getTimerCount()).toBe(1);

    cleanup!();
    cleanup = null;
    // The 1500ms timer used to survive teardown and write $state into a source
    // whose owner had unmounted.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("writes no status for an attempt that settles after teardown", async () => {
    const machine = mount();
    let settle!: () => void;
    const pending = machine.run(() => new Promise<void>((res) => { settle = res; }));

    cleanup!();
    cleanup = null;
    settle();
    await pending;
    expect(machine.status).toBe("idle");
  });

  it("writes no status for an attempt that fails after teardown", async () => {
    const machine = mount();
    let fail!: (e: Error) => void;
    const pending = machine.run(() => new Promise<void>((_res, rej) => { fail = rej; }));

    cleanup!();
    cleanup = null;
    fail(new Error("late failure"));
    await pending;
    expect(machine.status).toBe("idle");
  });
});
