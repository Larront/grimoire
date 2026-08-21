// The sample world exercises every shipped block (#186).
//
// The bundled ledger is Grimoire's introduction to itself, and it is also the one
// vault a GM opens having consented to nothing: they chose "Explore the sample world",
// not "open my campaign". So the blocks it demonstrates have to survive the first
// autosave — which happens on opening a note, before the GM has typed anything.
//
// Every file here is read from where it ships rather than from a copy
// (`fixtures/sample-world`), for the reason #182 gave when it did the same: a copy
// passes while the shipped note ships a fence Grimoire mis-reads.
//
// What is *not* here: how each block parses, serializes or draws. Infobox's grammar is
// pinned in infobox-block.test.ts, Callout's in callout-block.test.ts, Image's in
// image-block.test.ts, the claim at depth in block-markdown.test.ts. This file asserts
// only what the shipped content promises — that the panel, the box and the aligned
// image are really in these notes, and that opening them changes no bytes.
//
// ── Three content fixes the byte test forced, and the bugs behind them ───────────
//
// The round trip below found three notes that did *not* survive being opened, all of
// them from before this ticket and none of them a block's doing:
//
//   * `## Loot & Rewards` came back as `## Loot &amp; Rewards` — a heading entity-escaped
//     on the way out. The built-in Session template writes that same heading
//     (`commands/templates.rs`), so this one reaches every session note a GM creates.
//   * `**[[wikilink]]**` came back with its bold gone.
//   * A list item continued over three lines reflowed onto one, and a bare URL beside it
//     came back as an explicit `[url](url)`.
//
// Each is a bug in the editor's markdown serializer, and #186 forbids touching
// `src/lib` — so the shipped notes were reworded around them (an `and` for the `&`,
// no bold on a wikilink, one line for the credits) and the bugs want their own tickets.
// The rewording is what keeps the sample world uncorrupted; it is not a fix.
import { describe, it, expect, afterEach, vi } from "vitest";
import { closeNote, dom, note, saved } from "./fixtures/note-editor";
import { NOTES, fenceBody, frontmatterBlock, shipped, shipsFile } from "./fixtures/sample-world";

vi.mock("$lib/stores/link-resolver.svelte", () => ({
  linkResolver: { isKnown: () => true, prime: vi.fn(), resolve: vi.fn() },
}));

// Start Here embeds two scene fences, and a scene block view asks the store for the
// scene's tracks the moment it mounts. Without a ledger behind it that read rejects and
// vitest counts the rejection as a run failure — so the store answers with no scenes,
// which is all this file needs: what a Scene *draws* is scene-block.test.ts's subject.
vi.mock("$lib/stores/scenes.svelte", () => ({
  scenes: {
    get scenes() {
      return [];
    },
    getSlots: vi.fn(() => Promise.resolve([])),
    invalidateSlots: vi.fn(),
    createScene: vi.fn(),
  },
}));

afterEach(closeNote);

// ─── The bytes ────────────────────────────────────────────────────────────────

describe("every note carrying a block survives being opened", () => {
  // The sample ledger is a writable sandbox. A GM opens a note, the editor rewrites the
  // whole body on the next save, and a block that did not round-trip would corrupt the
  // world Grimoire ships to introduce itself — with no gesture from the GM to blame.
  //
  // Every note rather than only the changed ones: the notes without blocks cost nothing
  // to check and are the control group for the ones with.
  //
  // `saved()` trims, and so does the comparison: the file ends with the newline every
  // text file ends with and the serializer emits none.
  it.each(NOTES)("round-trips %s byte for byte", (rel) => {
    expect(saved(note(shipped(rel).body))).toBe(shipped(rel).body.trimEnd());
  });

  it("names no note the vault does not ship", () => {
    // The list above is this file's own claim about the vale, and a stale entry would
    // silently drop a note out of every check in it. How many notes there *are* is
    // `sample_world_integrity`'s to say — it counts what the importer found on disk,
    // where this can only count what someone typed.
    expect(NOTES.filter((rel) => !shipsFile(rel))).toEqual([]);
  });
});

// ─── The images ───────────────────────────────────────────────────────────────

describe("every image a note points at is bundled with it", () => {
  const IMAGE_SRC = /!\[[^\]]*\]\(([^)]+)\)/g;

  const references = NOTES.flatMap((rel) =>
    [...shipped(rel).raw.matchAll(IMAGE_SRC)].map((match) => [rel, match[1]] as const),
  );

  it("finds the two the world ships", () => {
    // A guard on the guard: a regex that stopped matching would leave the loop below
    // asserting nothing at all.
    expect(references.map(([, src]) => src).sort()).toEqual([
      ".grimoire/images/mira-ashvale.png",
      ".grimoire/images/the-ember-keep.png",
    ]);
  });

  it.each(references)("resolves %s's image %s", (_rel, src) => {
    // Ledger-relative and inside the vault, both: an absolute path or one reaching
    // outside would break the moment the fixture was copied into a GM's tempdir.
    expect(src.startsWith("/") || src.includes("..")).toBe(false);
    expect(shipsFile(src)).toBe(true);
  });

  it("files them where Grimoire itself files a pasted image", () => {
    // `.grimoire/images/` is `media.rs`'s own destination, so the sample world is filed
    // the way a real vault is rather than inventing a second convention.
    //
    // Note that ADR-0001 says `ledger/images/` for note images and `.grimoire/` for
    // app bookkeeping — the code has drifted from it, and #186 named the code's path
    // deliberately. What is pinned here is *the sample world agrees with the app*, not
    // that the app is right; reconciling the two is the ADR's own ticket to have.
    for (const [, src] of references) expect(src.startsWith(".grimoire/images/")).toBe(true);
  });
});

// ─── Thornhaven's panel ───────────────────────────────────────────────────────

describe("Thornhaven Village carries a titleless Infobox", () => {
  const { raw, body } = shipped("Locations/Thornhaven Village.md");

  it("opens as a panel rather than a grey code box", () => {
    const editor = note(body);

    expect(dom(editor).querySelectorAll("[data-infobox-block]")).toHaveLength(1);
    expect(dom(editor).querySelector("pre")).toBeNull();
  });

  it("writes no title, because the note's own heading already said it", () => {
    expect(fenceBody(raw, "infobox").startsWith("Region:")).toBe(true);
  });

  it("draws its rows from facts the note's own prose already carries", () => {
    const editor = note(body);
    const panel = dom(editor).querySelector("[data-infobox-block]")!;

    for (const fact of ["Muddy Boot", "Osric Thrane", "Three hours"]) {
      expect(panel).toHaveTextContent(fact);
    }
  });

  it("puts a resolving wikilink in a row value, so the panel reaches Backlinks", () => {
    // Row values are Linked Text Fields, and the link index scans the note's raw body —
    // so a `[[…]]` inside a fence is a real link in the graph, not decoration.
    expect(fenceBody(raw, "infobox")).toContain("[[Lore/The Ashfen Marshes.md]]");
    expect(shipsFile("Lore/The Ashfen Marshes.md")).toBe(true);
  });
});

// ─── Mira's panel ─────────────────────────────────────────────────────────────

describe("Mira Ashvale carries an Infobox with a thumbnail", () => {
  const { raw, body } = shipped("Characters/Mira Ashvale.md");

  /** The panel's rows — the fence without its two markdown-flavoured meta lines. */
  function rowLines(): string[] {
    return fenceBody(raw, "infobox")
      .split("\n")
      .filter((line) => line && !line.startsWith("![") && !line.startsWith("# "));
  }

  it("gives the subject a face, captioned by its alt text", () => {
    const editor = note(body);
    const panel = dom(editor).querySelector("[data-infobox-block]")!;

    expect(dom(editor).querySelectorAll("[data-infobox-block]")).toHaveLength(1);
    // The alt doubles as the visible caption, so the GM labels the portrait once —
    // which is also why the panel says it even when the file behind the path is gone.
    expect(panel).toHaveTextContent("Mira, drawn from the one time she sat still for it");
    expect(raw).toContain("](.grimoire/images/mira-ashvale.png)");
  });

  it("carries her aliases' subject matter without carrying the aliases", () => {
    // Frontmatter holds what the tool consumes; an Infobox holds what the reader sees.
    // #175 made that independence doctrine — no promotion in either direction. So the
    // aliases are read out of the frontmatter and every one of them is banned from the
    // rows, rather than one spelling being spot-checked.
    const aliases = frontmatterBlock(raw)
      .split("\n")
      .find((line) => line.startsWith("aliases:"))!
      .replace(/^aliases:\s*\[|\]$/g, "")
      .split(",")
      .map((alias) => alias.trim());
    const rows = rowLines().join("\n").toLowerCase();

    expect(aliases).toEqual(["Mira", "the Herbalist"]);
    for (const alias of aliases) expect(rows).not.toContain(alias.toLowerCase());
    // What survives the ban is the subject matter itself: what she trades in.
    expect(rows).toContain("remedies");
  });

  it("writes no title either, because her own heading is directly above it", () => {
    // A thumbnail is what makes this the panel's *other* form — not a title. The docs'
    // "not saying the same thing twice" applies here exactly as it does to Thornhaven.
    // The whole fence, not `rowLines()` — that helper filters `# ` lines out, so asking
    // it whether one is there could only ever get one answer.
    expect(
      fenceBody(raw, "infobox")
        .split("\n")
        .some((line) => line.startsWith("# ")),
    ).toBe(false);
  });

  it("duplicates no frontmatter key, and adds no frontmatter to feed a row", () => {
    const keys = frontmatterBlock(raw)
      .split("\n")
      .map((line) => line.split(":")[0].trim())
      .filter(Boolean);

    expect(keys.sort()).toEqual(["aliases", "tags"]);
    const fence = fenceBody(raw, "infobox").toLowerCase();
    for (const key of keys) expect(fence).not.toContain(`${key}:`);
  });
});

// ─── The Ember Keep's box and its picture ─────────────────────────────────────

describe("The Ember Keep reads aloud, beside an aligned image", () => {
  const { raw, body } = shipped("Locations/The Ember Keep.md");

  it("boxes the party's arrival as read-aloud text", () => {
    const editor = note(body);
    const quote = dom(editor).querySelector("blockquote");

    expect(raw).toContain("> [!read-aloud]");
    expect(quote).toBeTruthy();
    expect(quote).toHaveTextContent("The causeway ends where the gate used to be");
  });

  it("floats its picture to the right of the Description prose", () => {
    // A centred full-width image would demonstrate nothing the default does not.
    const description = raw.slice(raw.indexOf("## Description"), raw.indexOf("## Notable"));

    expect(description).toContain("{align=right width=40%}");
  });
});

// ─── The session's aside ──────────────────────────────────────────────────────

describe("Session 1 carries a GM aside under Notes", () => {
  const { raw, body } = shipped("Sessions/Session 1 — The Arrival.md");

  it("holds what Mira has not said out loud", () => {
    const editor = note(body);

    expect(raw.slice(raw.indexOf("## Notes"))).toContain("> [!note]");
    expect(dom(editor).querySelector("blockquote")).toHaveTextContent("her own family's");
  });

  it("leaves the prose that was already there alone", () => {
    expect(raw).toContain(
      "The carved fragment matches the description [[Mira]] gave of the puzzle-lock markers.",
    );
  });
});

// ─── The tour ─────────────────────────────────────────────────────────────────

describe("Start Here points at the blocks it now has to point at", () => {
  const { raw, body } = shipped("Start Here.md");
  const tour = raw.slice(raw.indexOf("## What to notice"), raw.indexOf("## Set the scene"));

  it("names every block it now has something to point at", () => {
    // Statblock because the acceptance criteria name it; Image because the ticket's own
    // prose counts it among "the three blocks" the tour gains. Both, rather than a
    // reading of which list wins.
    for (const block of ["Infobox", "Callout", "Image", "Statblock"]) {
      expect(tour).toContain(`**${block}**`);
    }
  });

  it("writes them in the register the rest of the list is written in", () => {
    // "A GM is being told what to look at, not read a changelog" — every bullet is a
    // bolded name, an em dash, and a sentence.
    const bullets = tour.split("\n").filter((line) => line.startsWith("- "));

    expect(bullets.length).toBeGreaterThanOrEqual(9);
    for (const bullet of bullets) expect(bullet).toMatch(/^- \*\*[^*]+\*\* — /);
  });

  it("carries a tip pointing at the blocks this page just gained", () => {
    const editor = note(body);

    expect(tour).toContain("> [!tip]");
    expect(dom(editor).querySelector("blockquote")).toHaveTextContent("This aside is a Callout");
  });

  it("still embeds the two scene fences the seeded scenes are checked against", () => {
    // `sample_world_integrity` reads the `Id:` lines here; this is the frontend's half
    // of that guard, so an edit to the tour cannot quietly drop them.
    expect([...raw.matchAll(/```scene\n/g)]).toHaveLength(2);
  });
});

// ─── What this ticket did not do ──────────────────────────────────────────────

describe("the vale gains blocks, not content", () => {
  it("ships one statblock, not two", () => {
    // #182 shipped The Lurker. A second creature is more sample world, not more Grimoire.
    const fences = NOTES.flatMap((rel) => [...shipped(rel).raw.matchAll(/```statblock\n/g)]);

    expect(fences).toHaveLength(1);
  });

  it("wraps the encounter's statblock in no callout", () => {
    // #151 settled that an Encounter is a note whose `## Monsters` heading does the
    // grouping. A `> [!encounter]` around the one creature is the redundancy that
    // decision exists to avoid.
    const { raw } = shipped("Encounters/The Shadow in the Hall.md");

    expect(raw).not.toContain("[!encounter]");
    expect(raw).toContain("## Monsters");
  });
});
