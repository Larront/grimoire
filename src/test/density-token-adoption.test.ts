import { render, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach } from "vitest";
import AppShell from "../lib/components/AppShell.svelte";

afterEach(cleanup);

// ── Icon rail ─────────────────────────────────────────────────────────────────

describe("icon rail — density tokens", () => {
  it("nav icons use --icon-rail-icon size variable", () => {
    render(AppShell);
    const rail = document.body.querySelector('[data-testid="icon-rail"]')!;
    const svgs = Array.from(rail.querySelectorAll("svg"));
    expect(svgs.length).toBeGreaterThan(0);
    const allVariableSize = svgs.every((svg) =>
      svg.classList.contains("size-(--icon-rail-icon)"),
    );
    expect(allVariableSize).toBe(true);
  });

  it("icon rail buttons use --row-h for their size", () => {
    render(AppShell);
    const rail = document.body.querySelector('[data-testid="icon-rail"]')!;
    const buttons = Array.from(rail.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(0);
    const allRowH = buttons.every((btn) =>
      btn.classList.contains("size-(--row-h)"),
    );
    expect(allRowH).toBe(true);
  });
});

// ── AppSearch ─────────────────────────────────────────────────────────────────

describe("AppSearch — density tokens", () => {
  it("search bar uses --row-h height token", () => {
    render(AppShell);
    const searchBar = document.body.querySelector(
      '[data-testid="app-search-bar"]',
    )!;
    expect(searchBar).toBeTruthy();
    expect(searchBar.classList.contains("h-(--row-h)")).toBe(true);
  });

  it("search bar uses --pad-x padding token", () => {
    render(AppShell);
    const searchBar = document.body.querySelector(
      '[data-testid="app-search-bar"]',
    )!;
    expect(searchBar).toBeTruthy();
    expect(searchBar.classList.contains("px-(--pad-x)")).toBe(true);
  });
});

// ── Sidebar group labels ──────────────────────────────────────────────────────

describe("sidebar group labels — density tokens", () => {
  it("group labels use --row-h height token", () => {
    render(AppShell);
    const labels = document.body.querySelectorAll(
      '[data-sidebar="group-label"]',
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of Array.from(labels)) {
      expect(label.classList.contains("h-(--row-h)")).toBe(true);
    }
  });

  it("group labels use --pad-x padding token", () => {
    render(AppShell);
    const labels = document.body.querySelectorAll(
      '[data-sidebar="group-label"]',
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of Array.from(labels)) {
      expect(label.classList.contains("px-(--pad-x)")).toBe(true);
    }
  });
});
