import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { toast as sonner } from "svelte-sonner";
import { toastError, toastSuccess, toastUndo, toastUnreadableNotes } from "../lib/toast";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toastError", () => {
  it("auto-expires (finite duration) instead of persisting forever", () => {
    toastError("Something broke");
    const opts = vi.mocked(sonner.error).mock.calls[0][1] as {
      duration: number;
    };
    expect(opts.duration).toBeGreaterThan(0);
    expect(opts.duration).toBeLessThan(Infinity);
  });

  it("dedupes identical errors via a stable id (the message)", () => {
    toastError("Something broke");
    expect(sonner.error).toHaveBeenCalledWith(
      "Something broke",
      expect.objectContaining({ id: "Something broke" }),
    );
  });
});

describe("toastSuccess", () => {
  it("calls sonner with duration 3000", () => {
    toastSuccess("Saved");
    expect(sonner.success).toHaveBeenCalledWith(
      "Saved",
      expect.objectContaining({ duration: 3000 }),
    );
  });
});

describe("toastUnreadableNotes", () => {
  type Opts = {
    duration: number;
    description: string;
    action: { label: string; onClick: (e: Event) => void };
  };
  const last = () => vi.mocked(sonner).mock.calls.at(-1) as unknown as [string, Opts];

  it("takes the toast down when nothing is left unread", () => {
    toastUnreadableNotes(0, false, vi.fn());
    expect(sonner).not.toHaveBeenCalled();
    expect(sonner.dismiss).toHaveBeenCalledWith("import-failures");
  });

  it("is calm, not an error, and stays: nothing was lost", () => {
    toastUnreadableNotes(2, false, vi.fn());
    expect(sonner.error).not.toHaveBeenCalled();
    const [title, opts] = last();
    expect(title).toBe("2 notes couldn't be opened");
    expect(opts.description).toMatch(/safe in your world's folder, untouched/);
    expect(opts.duration).toBeGreaterThan(24 * 60 * 60 * 1000);
    expect(opts.action.label).toBe("Show notes");
  });

  it("counts down in the singular", () => {
    toastUnreadableNotes(1, true, vi.fn());
    const [title, opts] = last();
    expect(title).toBe("1 note still can't be opened");
    expect(opts.description).toMatch(/^It's safe/);
  });

  it("opens the list and stays up", () => {
    const onShow = vi.fn();
    toastUnreadableNotes(1, false, onShow);
    const event = new Event("click", { cancelable: true });
    last()[1].action.onClick(event);
    expect(onShow).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("toastUndo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a toast with an Undo action", () => {
    toastUndo("Note deleted", vi.fn());
    expect(sonner).toHaveBeenCalledWith(
      "Note deleted",
      expect.objectContaining({
        action: expect.objectContaining({ label: "Undo" }),
      }),
    );
  });

  it("executes onConfirm after duration when undo is not clicked", () => {
    const onConfirm = vi.fn();
    toastUndo("Note deleted", onConfirm);
    vi.advanceTimersByTime(5000);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("does NOT execute onConfirm when undo action is clicked", () => {
    const onConfirm = vi.fn();
    toastUndo("Note deleted", onConfirm);

    clickUndo();

    vi.advanceTimersByTime(5000);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /*
    `onUndo` is for callers that removed the thing from the UI on click rather than
    waiting out the window — a pin has to leave the map immediately or the button looks
    broken. Those callers need somewhere to put it back.
  */
  it("calls onUndo when undo is clicked", () => {
    const onConfirm = vi.fn();
    const onUndo = vi.fn();
    toastUndo("Pin deleted", onConfirm, onUndo);

    clickUndo();

    expect(onUndo).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not call onUndo when the window simply elapses", () => {
    const onConfirm = vi.fn();
    const onUndo = vi.fn();
    toastUndo("Pin deleted", onConfirm, onUndo);

    vi.advanceTimersByTime(5000);

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onUndo).not.toHaveBeenCalled();
  });

  /* The file tree and template list pass two arguments and must stay unaffected. */
  it("is safe to call without onUndo", () => {
    const onConfirm = vi.fn();
    toastUndo("Note deleted", onConfirm);
    expect(() => clickUndo()).not.toThrow();
    vi.advanceTimersByTime(5000);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  function clickUndo() {
    const options = vi.mocked(sonner).mock.calls.at(-1)![1] as unknown as {
      action: { onClick: (e: MouseEvent) => void };
    };
    options.action.onClick(new MouseEvent("click"));
  }
});
