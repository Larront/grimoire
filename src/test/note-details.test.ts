import { render, fireEvent, cleanup, act } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import NoteDetails from "../lib/components/NoteDetails.svelte";
import type { AliasCollision, BacklinkNote, OutboundLink } from "../lib/components/NoteDetails.svelte";
import type { Note } from "../lib/types/ledger";

afterEach(() => {
  cleanup();
});

const testNote: Note = {
  id: 1,
  path: "Characters/Aldric.md",
  title: "Aldric",
  icon: null,
  cover_image: null,
  parent_path: "Characters",
  archived: false,
  modified_at: "2026-01-01T00:00:00Z",
};

// ── Rendering ─────────────────────────────────────────────────────────────────

describe("NoteDetails — rendering", () => {
  it("all 6 sections render when note is non-null", () => {
    const { container } = render(NoteDetails, { props: { note: testNote } });
    expect(container.querySelector('[data-section="tags"]')).toBeTruthy();
    expect(container.querySelector('[data-section="aliases"]')).toBeTruthy();
    expect(container.querySelector('[data-section="backlinks"]')).toBeTruthy();
    expect(container.querySelector('[data-section="outbound"]')).toBeTruthy();
    expect(container.querySelector('[data-section="folder"]')).toBeTruthy();
    expect(container.querySelector('[data-section="modified"]')).toBeTruthy();
  });

  it("renders nothing when note is null", () => {
    const { container } = render(NoteDetails, { props: { note: null } });
    expect(container.querySelector('[data-section]')).toBeNull();
  });

  it("section order is tags → aliases → backlinks → outbound → folder → modified", () => {
    const { container } = render(NoteDetails, { props: { note: testNote } });
    const sections = Array.from(container.querySelectorAll("[data-section]"));
    const names = sections.map((s) => s.getAttribute("data-section"));
    const idx = (name: string) => names.indexOf(name);
    expect(idx("tags")).toBeGreaterThanOrEqual(0);
    expect(idx("aliases")).toBeGreaterThan(idx("tags"));
    expect(idx("backlinks")).toBeGreaterThan(idx("aliases"));
    expect(idx("outbound")).toBeGreaterThan(idx("backlinks"));
    expect(idx("folder")).toBeGreaterThan(idx("outbound"));
    expect(idx("modified")).toBeGreaterThan(idx("folder"));
  });
});

// ── Tags section ──────────────────────────────────────────────────────────────

describe("NoteDetails — tags section", () => {
  it("shows 'Tags unavailable' on tagsLoadError", () => {
    const { container } = render(NoteDetails, {
      props: { note: testNote, tagsLoadError: true },
    });
    const section = container.querySelector('[data-section="tags"]')!;
    expect(section.textContent).toContain("Tags unavailable");
  });

  it("shows hint text when tags are empty and no error", () => {
    const { container } = render(NoteDetails, {
      props: { note: testNote, tags: [], tagsLoadError: false },
    });
    const section = container.querySelector('[data-section="tags"]')!;
    expect(section.textContent).toContain("Enter to add");
  });
});

// ── Aliases section ───────────────────────────────────────────────────────────

describe("NoteDetails — aliases section", () => {
  it("shows 'Aliases unavailable' on aliasesLoadError", () => {
    const { container } = render(NoteDetails, {
      props: { note: testNote, aliasesLoadError: true },
    });
    const section = container.querySelector('[data-section="aliases"]')!;
    expect(section.textContent).toContain("Aliases unavailable");
  });

  it("no alias collision warnings when aliasCollisions is empty", () => {
    const { container } = render(NoteDetails, {
      props: { note: testNote, aliasCollisions: [] },
    });
    expect(container.querySelector('[data-slot="alias-collision-warning"]')).toBeNull();
  });

  it("alias collision warning appears when aliasCollisions has entry", () => {
    const aliasCollisions: AliasCollision[] = [
      { alias: "Captain Ash", other_note_id: 2, other_note_title: "Ash Note" },
    ];
    const { container } = render(NoteDetails, {
      props: { note: testNote, aliasCollisions },
    });
    const warning = container.querySelector('[data-slot="alias-collision-warning"]')!;
    expect(warning).toBeTruthy();
    expect(warning.textContent).toContain("Captain Ash");
    expect(warning.textContent).toContain("Ash Note");
  });
});

// ── Backlinks section ─────────────────────────────────────────────────────────

describe("NoteDetails — backlinks section", () => {
  it("shows 'No backlinks yet' when backlinks is empty", () => {
    const { container } = render(NoteDetails, {
      props: { note: testNote, backlinks: [] },
    });
    const section = container.querySelector('[data-section="backlinks"]')!;
    expect(section.textContent).toContain("No backlinks yet");
  });

  it("renders backlink-row items", () => {
    const backlinks: BacklinkNote[] = [
      { id: 2, path: "Characters/Bard.md", title: "Bard" },
      { id: 3, path: "Places/Inn.md", title: "Inn" },
    ];
    const { container } = render(NoteDetails, {
      props: { note: testNote, backlinks },
    });
    const rows = container.querySelectorAll('[data-slot="backlink-row"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("Bard");
    expect(rows[1].textContent).toContain("Inn");
  });

  it("shows folder path in link-folder", () => {
    const backlinks: BacklinkNote[] = [
      { id: 2, path: "Characters/Bard.md", title: "Bard" },
    ];
    const { container } = render(NoteDetails, {
      props: { note: testNote, backlinks },
    });
    const folder = container.querySelector('[data-slot="link-folder"]')!;
    expect(folder).toBeTruthy();
    expect(folder.textContent).toContain("Characters");
  });

  it("caps at 5 rows when there are more than 5", () => {
    const backlinks: BacklinkNote[] = Array.from({ length: 8 }, (_, i) => ({
      id: i + 2,
      path: `Notes/Note${i}.md`,
      title: `Note ${i}`,
    }));
    const { container } = render(NoteDetails, {
      props: { note: testNote, backlinks },
    });
    const rows = container.querySelectorAll('[data-slot="backlink-row"]');
    expect(rows.length).toBe(5);
  });

  it("shows expand button with 'N more' when capped", () => {
    const backlinks: BacklinkNote[] = Array.from({ length: 8 }, (_, i) => ({
      id: i + 2,
      path: `Notes/Note${i}.md`,
      title: `Note ${i}`,
    }));
    const { container } = render(NoteDetails, {
      props: { note: testNote, backlinks },
    });
    const btn = container.querySelector('[data-slot="backlinks-expand"]')!;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("3 more");
  });

  it("clicking expand shows all rows", async () => {
    const backlinks: BacklinkNote[] = Array.from({ length: 7 }, (_, i) => ({
      id: i + 2,
      path: `Notes/Note${i}.md`,
      title: `Note ${i}`,
    }));
    const { container } = render(NoteDetails, {
      props: { note: testNote, backlinks },
    });
    const btn = container.querySelector('[data-slot="backlinks-expand"]') as HTMLElement;
    await fireEvent.click(btn);
    const rows = container.querySelectorAll('[data-slot="backlink-row"]');
    expect(rows.length).toBe(7);
  });

  it("clicking backlink row calls onNavigateNote(id, title)", async () => {
    const onNavigateNote = vi.fn();
    const backlinks: BacklinkNote[] = [
      { id: 2, path: "Characters/Bard.md", title: "Bard" },
    ];
    const { container } = render(NoteDetails, {
      props: { note: testNote, backlinks, onNavigateNote },
    });
    const row = container.querySelector('[data-slot="backlink-row"]') as HTMLElement;
    await fireEvent.click(row);
    expect(onNavigateNote).toHaveBeenCalledWith(2, "Bard");
  });
});

// ── Outbound Links section ────────────────────────────────────────────────────

describe("NoteDetails — outbound links section", () => {
  it("shows 'No outbound links' when outboundLinks is empty", () => {
    const { container } = render(NoteDetails, {
      props: { note: testNote, outboundLinks: [] },
    });
    const section = container.querySelector('[data-section="outbound"]')!;
    expect(section.textContent).toContain("No outbound links");
  });

  it("renders outbound-row for resolved links", () => {
    const outboundLinks: OutboundLink[] = [
      {
        target_path: "Characters/Bard.md",
        resolved_id: 2,
        resolved_title: "Bard",
        resolved_path: "Characters/Bard.md",
      },
    ];
    const { container } = render(NoteDetails, {
      props: { note: testNote, outboundLinks },
    });
    const rows = container.querySelectorAll('[data-slot="outbound-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("Bard");
  });

  it("renders outbound-broken for broken links as a clickable button", () => {
    const outboundLinks: OutboundLink[] = [
      {
        target_path: "Missing/Ghost.md",
        resolved_id: null,
        resolved_title: null,
        resolved_path: null,
      },
    ];
    const { container } = render(NoteDetails, {
      props: { note: testNote, outboundLinks },
    });
    const broken = container.querySelector('[data-slot="outbound-broken"]')!;
    expect(broken).toBeTruthy();
    expect(broken.textContent).toContain("Not yet created");
    expect(broken.tagName.toLowerCase()).toBe("button");
  });

  it("clicking broken outbound row calls onCreateStub with the target_path", async () => {
    const onCreateStub = vi.fn();
    const outboundLinks: OutboundLink[] = [
      {
        target_path: "Missing/Ghost.md",
        resolved_id: null,
        resolved_title: null,
        resolved_path: null,
      },
    ];
    const { container } = render(NoteDetails, {
      props: { note: testNote, outboundLinks, onCreateStub },
    });
    const broken = container.querySelector('[data-slot="outbound-broken"]') as HTMLElement;
    await fireEvent.click(broken);
    expect(onCreateStub).toHaveBeenCalledWith("Missing/Ghost.md");
  });

  it("caps outbound at 5 rows when there are more", () => {
    const outboundLinks: OutboundLink[] = Array.from({ length: 8 }, (_, i) => ({
      target_path: `Notes/Note${i}.md`,
      resolved_id: i + 2,
      resolved_title: `Note ${i}`,
      resolved_path: `Notes/Note${i}.md`,
    }));
    const { container } = render(NoteDetails, {
      props: { note: testNote, outboundLinks },
    });
    const rows = container.querySelectorAll('[data-slot="outbound-row"]');
    expect(rows.length).toBe(5);
    const expandBtn = container.querySelector('[data-slot="outbound-expand"]');
    expect(expandBtn).toBeTruthy();
    expect(expandBtn!.textContent).toContain("3 more");
  });

  it("clicking outbound expand shows all rows", async () => {
    const outboundLinks: OutboundLink[] = Array.from({ length: 7 }, (_, i) => ({
      target_path: `Notes/Note${i}.md`,
      resolved_id: i + 2,
      resolved_title: `Note ${i}`,
      resolved_path: `Notes/Note${i}.md`,
    }));
    const { container } = render(NoteDetails, {
      props: { note: testNote, outboundLinks },
    });
    const btn = container.querySelector('[data-slot="outbound-expand"]') as HTMLElement;
    await fireEvent.click(btn);
    const rows = container.querySelectorAll('[data-slot="outbound-row"]');
    expect(rows.length).toBe(7);
  });

  it("clicking outbound row calls onNavigateNote", async () => {
    const onNavigateNote = vi.fn();
    const outboundLinks: OutboundLink[] = [
      {
        target_path: "Characters/Bard.md",
        resolved_id: 2,
        resolved_title: "Bard",
        resolved_path: "Characters/Bard.md",
      },
    ];
    const { container } = render(NoteDetails, {
      props: { note: testNote, outboundLinks, onNavigateNote },
    });
    const row = container.querySelector('[data-slot="outbound-row"]') as HTMLElement;
    await fireEvent.click(row);
    expect(onNavigateNote).toHaveBeenCalledWith(2, "Bard");
  });

  it("expand state resets when note changes", async () => {
    const note1: Note = { ...testNote, id: 1 };
    const note2: Note = { ...testNote, id: 2, path: "Notes/Other.md", title: "Other" };
    const outboundLinks: OutboundLink[] = Array.from({ length: 7 }, (_, i) => ({
      target_path: `Notes/Note${i}.md`,
      resolved_id: i + 10,
      resolved_title: `Note ${i}`,
      resolved_path: `Notes/Note${i}.md`,
    }));

    const { container, rerender } = render(NoteDetails, {
      props: { note: note1, outboundLinks },
    });

    // Expand
    const btn = container.querySelector('[data-slot="outbound-expand"]') as HTMLElement;
    await fireEvent.click(btn);
    expect(container.querySelectorAll('[data-slot="outbound-row"]').length).toBe(7);

    // Change note — expanded state should reset
    await rerender({ note: note2, outboundLinks });
    expect(container.querySelectorAll('[data-slot="outbound-row"]').length).toBe(5);
  });
});
