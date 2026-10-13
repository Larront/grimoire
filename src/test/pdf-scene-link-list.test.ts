// "Scenes in this PDF": every link in page order, one row each, to jump to or play.
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi } from "vitest";
import PdfSceneLinkList from "../lib/components/panes/PdfSceneLinkList.svelte";
import type { PdfSceneLink } from "../lib/bindings.gen";
import type { SceneWithCount } from "../lib/types/ledger";

vi.mock("../lib/stores/audio-engine.svelte", () => ({
  audioEngine: { playScene: vi.fn(), stopAll: vi.fn(), isScenePlaying: () => false },
}));
const { audioEngine } = await import("../lib/stores/audio-engine.svelte");

const scene = (id: number, name: string, slot_count = 2): SceneWithCount => ({
  id,
  name,
  favorited: 0,
  created_at: "2026-10-13",
  slot_count,
  thumbnail_path: null,
  thumbnail_color: null,
  thumbnail_icon: null,
});
const link = (id: number, page: number, start: number, scene_id: number, quote: string) =>
  ({ id, pdf_path: "a.pdf", page, start_offset: start, end_offset: start + quote.length, quote, scene_id, created_at: "" }) as PdfSceneLink;

const scenesById = new Map([
  [1, scene(1, "Boss Battle")],
  [2, scene(2, "Town Market", 0)],
]);

describe("PdfSceneLinkList", () => {
  it("lists links in page order and jumps to the one clicked", async () => {
    const onJump = vi.fn();
    const links = [link(9, 2, 10, 2, "dripping stone"), link(4, 1, 50, 1, "There is no sound")];
    const { getAllByTitle } = render(PdfSceneLinkList, { links, scenesById, onJump });
    const rows = getAllByTitle(/Go to page/);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Boss Battle"),
      expect.stringContaining("Town Market"),
    ]);
    await fireEvent.click(rows[1]);
    expect(onJump).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }));
  });

  it("plays from the row, but not a scene with no tracks", async () => {
    const links = [link(4, 1, 50, 1, "There is no sound"), link(9, 2, 10, 2, "dripping stone")];
    const { getByLabelText } = render(PdfSceneLinkList, { links, scenesById, onJump: vi.fn() });
    await fireEvent.click(getByLabelText("Play Boss Battle"));
    expect(audioEngine.playScene).toHaveBeenCalledWith(1);
    expect(getByLabelText("Play Town Market").hasAttribute("disabled")).toBe(true);
  });

  it("says how to make one when there are none", () => {
    const { getByText } = render(PdfSceneLinkList, { links: [], scenesById, onJump: vi.fn() });
    expect(getByText(/No scenes linked yet/)).toBeTruthy();
  });
});
