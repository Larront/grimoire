import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

import { toast as sonner } from "svelte-sonner";
import { toastError, toastSuccess, toastUndo } from "../lib/toast";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toastError", () => {
  it("calls sonner.error with duration Infinity", () => {
    toastError("Something broke");
    expect(sonner.error).toHaveBeenCalledWith(
      "Something broke",
      expect.objectContaining({ duration: Infinity }),
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

    const options = vi.mocked(sonner).mock.calls[0][1] as unknown as {
      action: { onClick: (e: MouseEvent) => void };
    };
    options.action.onClick(new MouseEvent("click"));

    vi.advanceTimersByTime(5000);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
