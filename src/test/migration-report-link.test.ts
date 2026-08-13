import { render, cleanup, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import MigrationReportBody from "../lib/components/toasts/MigrationReportBody.svelte";

// The component reaches the file manager through the opener plugin, dynamically
// imported so the module never has to exist outside Tauri.
const { revealItemInDir } = vi.hoisted(() => ({
  revealItemInDir: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir }));

const PATH =
  "C:/Ledgers/Aurelia/.grimoire/format-backup-20260730T120000Z/migration-report.md";
const PROSE =
  "Copies of them from before the change, and a report of what changed, are here:";

function mount(onError = vi.fn()) {
  const r = render(MigrationReportBody, {
    props: { prose: PROSE, reportPath: PATH, onError },
  });
  return { ...r, onError, link: r.getByRole("button") };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("the migration report is a place the GM can get to", () => {
  it("reveals the report in the file manager when the link is clicked", async () => {
    const { link } = mount();
    await fireEvent.click(link);
    await waitFor(() => expect(revealItemInDir).toHaveBeenCalledOnce());
    // The exact path the migration reported, not a directory guessed from it.
    expect(revealItemInDir).toHaveBeenCalledWith(PATH);
  });

  it("names the report by its file name, so the link cannot wrap mid-path", () => {
    const { link } = mount();
    expect(link.textContent?.trim()).toBe("migration-report.md");
    expect(link.textContent).not.toContain("/");
  });

  it("keeps the full path reachable as the tooltip", () => {
    const { link } = mount();
    expect(link.getAttribute("title")).toBe(PATH);
  });

  it("says where the link goes, for anyone not reading the prose", () => {
    const { link } = mount();
    expect(link.getAttribute("aria-label")).toBe(
      "Show migration-report.md in the file manager",
    );
  });

  it("still renders the sentence the toast was written with", () => {
    const { container } = mount();
    expect(container.textContent).toContain(PROSE);
  });

  it("reports a failed reveal instead of dying silently", async () => {
    revealItemInDir.mockRejectedValueOnce(new Error("path not found"));
    const { link, onError } = mount();
    await fireEvent.click(link);
    // A click that does nothing and says nothing is the failure mode here: the
    // report may have been moved or deleted since the migration ran.
    await waitFor(() => expect(onError).toHaveBeenCalledOnce());
  });

  it("handles a backslash path, which is what Windows actually reports", () => {
    const win =
      "C:\\Ledgers\\Aurelia\\.grimoire\\format-backup-20260730T120000Z\\migration-report.md";
    const { getByRole } = render(MigrationReportBody, {
      props: { prose: PROSE, reportPath: win, onError: vi.fn() },
    });
    expect(getByRole("button").textContent?.trim()).toBe("migration-report.md");
  });
});
