import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import AnnotationDetails from "$lib/components/map/AnnotationDetails.svelte";

afterEach(() => {
  cleanup();
});

const baseAnnotation = {
  id: 1,
  map_id: 5,
  kind: "rect" as const,
  x: 10,
  y: 20,
  x2: 100,
  y2: 80,
  radius: null,
  label: null,
  color: "#e2e8f0",
  stroke_color: "#94a3b8",
  stroke_width: 2,
  font_size: 16,
  opacity: 0.2,
  created_at: "2026-01-01T00:00:00Z",
};

const textAnnotation = {
  ...baseAnnotation,
  kind: "text" as const,
  label: "My Label",
  x2: null,
  y2: null,
};

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ── Rendering ─────────────────────────────────────────────────────────────────

describe("AnnotationDetails — rendering", () => {
  it("renders kind badge for rect annotation", async () => {
    const { getByText } = render(AnnotationDetails, {
      props: { annotation: baseAnnotation, onUpdate: vi.fn(), onDelete: vi.fn() },
    });
    await flush();
    expect(getByText("Rectangle")).toBeTruthy();
  });

  it("renders kind badge for text annotation", async () => {
    const { getByText } = render(AnnotationDetails, {
      props: { annotation: textAnnotation, onUpdate: vi.fn(), onDelete: vi.fn() },
    });
    await flush();
    expect(getByText("Text Label")).toBeTruthy();
  });

  it("renders kind badge for circle annotation", async () => {
    const circleAnnotation = { ...baseAnnotation, kind: "circle" as const };
    const { getByText } = render(AnnotationDetails, {
      props: { annotation: circleAnnotation, onUpdate: vi.fn(), onDelete: vi.fn() },
    });
    await flush();
    expect(getByText("Circle")).toBeTruthy();
  });

  it("renders lock button when locked", async () => {
    const { container } = render(AnnotationDetails, {
      props: { annotation: baseAnnotation, onUpdate: vi.fn(), onDelete: vi.fn() },
    });
    await flush();
    expect(container.querySelector('button[title="Unlock to drag"]')).toBeTruthy();
  });

  it("renders opacity section for shape annotations", async () => {
    const { container } = render(AnnotationDetails, {
      props: { annotation: baseAnnotation, onUpdate: vi.fn(), onDelete: vi.fn() },
    });
    await flush();
    expect(container.querySelector('[data-section="opacity"]')).toBeTruthy();
  });

  it("renders stroke section for shape annotations", async () => {
    const { container } = render(AnnotationDetails, {
      props: { annotation: baseAnnotation, onUpdate: vi.fn(), onDelete: vi.fn() },
    });
    await flush();
    expect(container.querySelector('[data-section="stroke"]')).toBeTruthy();
  });

  it("renders label section for text annotations", async () => {
    const { container } = render(AnnotationDetails, {
      props: { annotation: textAnnotation, onUpdate: vi.fn(), onDelete: vi.fn() },
    });
    await flush();
    expect(container.querySelector('[data-section="label"]')).toBeTruthy();
  });

  it("renders font-size section for text annotations", async () => {
    const { container } = render(AnnotationDetails, {
      props: { annotation: textAnnotation, onUpdate: vi.fn(), onDelete: vi.fn() },
    });
    await flush();
    expect(container.querySelector('[data-section="font-size"]')).toBeTruthy();
  });

  it("does not render label section for shape annotations", async () => {
    const { container } = render(AnnotationDetails, {
      props: { annotation: baseAnnotation, onUpdate: vi.fn(), onDelete: vi.fn() },
    });
    await flush();
    expect(container.querySelector('[data-section="label"]')).toBeNull();
  });

  it("does not render opacity section for text annotations", async () => {
    const { container } = render(AnnotationDetails, {
      props: { annotation: textAnnotation, onUpdate: vi.fn(), onDelete: vi.fn() },
    });
    await flush();
    expect(container.querySelector('[data-section="opacity"]')).toBeNull();
  });

  it("renders ColorSwatches for color section", async () => {
    const { container } = render(AnnotationDetails, {
      props: { annotation: baseAnnotation, onUpdate: vi.fn(), onDelete: vi.fn() },
    });
    await flush();
    expect(container.querySelector('[data-slot="color-swatches"]')).toBeTruthy();
  });

  it("renders delete button in actions section", async () => {
    const { container } = render(AnnotationDetails, {
      props: { annotation: baseAnnotation, onUpdate: vi.fn(), onDelete: vi.fn() },
    });
    await flush();
    expect(container.querySelector('[data-section="actions"] button')).toBeTruthy();
  });
});

// ── Lock / unlock ─────────────────────────────────────────────────────────────

describe("AnnotationDetails — lock/unlock", () => {
  it("calls onToggleLock when lock button is clicked", async () => {
    const onToggleLock = vi.fn();
    const { container } = render(AnnotationDetails, {
      props: {
        annotation: baseAnnotation,
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        onToggleLock,
      },
    });
    await flush();
    const btn = container.querySelector('button[title="Unlock to drag"]') as HTMLElement;
    await fireEvent.click(btn);
    expect(onToggleLock).toHaveBeenCalledOnce();
  });

  it("shows lock annotation button when unlocked=true", async () => {
    const { container } = render(AnnotationDetails, {
      props: {
        annotation: baseAnnotation,
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        unlocked: true,
      },
    });
    await flush();
    expect(container.querySelector('button[title="Lock annotation"]')).toBeTruthy();
  });
});

// ── Label editing ─────────────────────────────────────────────────────────────

describe("AnnotationDetails — label editing", () => {
  it("calls onUpdate with new label on blur", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(AnnotationDetails, {
      props: { annotation: textAnnotation, onUpdate, onDelete: vi.fn() },
    });
    await flush();
    const input = container.querySelector(
      'input[placeholder="Label text"]',
    ) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "New Label" } });
    await fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ label: "New Label" }),
    );
  });

  it("does not call onUpdate when label is unchanged on blur", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(AnnotationDetails, {
      props: { annotation: textAnnotation, onUpdate, onDelete: vi.fn() },
    });
    await flush();
    const input = container.querySelector(
      'input[placeholder="Label text"]',
    ) as HTMLInputElement;
    await fireEvent.blur(input);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

// ── Color updates ─────────────────────────────────────────────────────────────

describe("AnnotationDetails — color updates", () => {
  it("calls onUpdate with new fill color when a swatch is clicked", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(AnnotationDetails, {
      props: { annotation: baseAnnotation, onUpdate, onDelete: vi.fn() },
    });
    await flush();
    const colorSection = container.querySelector('[data-section="color"]');
    expect(colorSection).toBeTruthy();
    const swatch = colorSection!.querySelector(
      '[data-slot="color-swatches"] button',
    ) as HTMLElement;
    await fireEvent.click(swatch);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ color: expect.any(String) }),
    );
  });

  it("calls onUpdate with new stroke color when stroke swatch is clicked", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const { container } = render(AnnotationDetails, {
      props: { annotation: baseAnnotation, onUpdate, onDelete: vi.fn() },
    });
    await flush();
    const strokeSection = container.querySelector('[data-section="stroke"]');
    expect(strokeSection).toBeTruthy();
    const swatch = strokeSection!.querySelector(
      '[data-slot="color-swatches"] button',
    ) as HTMLElement;
    await fireEvent.click(swatch);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ stroke_color: expect.any(String) }),
    );
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

describe("AnnotationDetails — delete", () => {
  it("calls onDelete with annotation id when delete button is clicked", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const { container } = render(AnnotationDetails, {
      props: { annotation: baseAnnotation, onUpdate: vi.fn(), onDelete },
    });
    await flush();
    const btn = container.querySelector(
      '[data-section="actions"] button',
    ) as HTMLElement;
    await fireEvent.click(btn);
    expect(onDelete).toHaveBeenCalledWith(1);
  });
});
