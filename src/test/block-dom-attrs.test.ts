// A Note Block's record crossing the DOM and coming back whole (#209).
//
// The seam under test is the *clipboard*: a block copied inside the editor travels as
// HTML, not as markdown, so its whole record has to go out through `renderHTML` and read
// back through `parseHTML`. A field missing from either side fails silently — the value is
// simply not there afterwards, and the note's next autosave writes the loss into the file.
//
// Two levels, because the failure has two shapes. The lower one is the `blockDom` table
// itself: what a field's default is, where it lives on the element, and whether each pair
// of `write`/`read` is inverse. The upper one is every block that declares such a table,
// driven through the app's real schema — a node built, serialized to an element, parsed
// back, and its attributes compared field for field.
//
// The compiler now catches the enumeration mistakes these guard against, which is the
// point of the ticket; these hold the parts a type cannot state — that `read` inverts
// `write`, and that the element a block writes is one the same block can read.
import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { DOMParser, DOMSerializer, type Schema } from "@tiptap/pm/model";
import { noteExtensions } from "$lib/editor/note-extensions";
import { blockDom, listAttr, textAttr } from "$lib/editor/block-attrs";

// ─── The table ────────────────────────────────────────────────────────────────

interface Sample {
  title: string;
  count: number;
  tags: string[];
}

const SAMPLE_DOM = blockDom<Sample>({
  title: textAttr("Untitled"),
  count: {
    default: 0,
    dataset: "howMany",
    write: (count) => String(count),
    read: (raw) => (raw === undefined || raw === "" ? 0 : Number(raw)),
  },
  tags: listAttr<string>(),
});

describe("a block's DOM table", () => {
  it("declares one node attribute per field of the record, with its default", () => {
    expect(Object.keys(SAMPLE_DOM.attributes)).toEqual(["title", "count", "tags"]);
    expect(SAMPLE_DOM.defaults).toEqual({
      title: "Untitled",
      count: 0,
      tags: [],
    });
  });

  it("writes a camel-cased field as its kebab-cased data attribute", () => {
    const written = SAMPLE_DOM.dataset({
      title: "Harbor's End",
      count: 2,
      tags: ["port"],
    });

    // `howMany` is the entry's own name, which is what lets Scene keep the `data-id` it
    // has always written while the record calls the field `sceneId`.
    expect(Object.keys(written)).toEqual(["data-title", "data-how-many", "data-tags"]);
  });

  it("reads back what it wrote, for every kind of field", () => {
    const record: Sample = {
      // A value holding everything a dataset entry has to survive: a wikilink, quotes,
      // an ampersand and an angle bracket.
      title: 'A "[[Captain Ash]]" & <b>',
      count: 43,
      tags: ["Population: 4,200", "Ruler: [[Captain Ash]]", "a\nline break"],
    };
    const written = SAMPLE_DOM.dataset(record);
    const element = document.createElement("div");
    for (const [name, value] of Object.entries(written)) {
      element.setAttribute(name, value);
    }

    const read = Object.fromEntries(
      Object.entries(SAMPLE_DOM.attributes).map(([field, spec]) => [
        field,
        spec.parseHTML(element),
      ]),
    );
    expect(read).toEqual(record);
  });

  it("stands in the default for an entry the element does not carry", () => {
    const bare = document.createElement("div");
    const read = Object.fromEntries(
      Object.entries(SAMPLE_DOM.attributes).map(([field, spec]) => [field, spec.parseHTML(bare)]),
    );
    expect(read).toEqual(SAMPLE_DOM.defaults);
  });

  it("refuses a table where two fields claim one entry", () => {
    // The one mistake the table's type cannot state: `BlockDom<R>` demands an entry per
    // field and says nothing about two entries landing on the same attribute, where the
    // second overwrites the first on the way out and both read it back.
    expect(() =>
      blockDom<{ sceneId: number | null; sceneName: string }>({
        sceneId: {
          dataset: "name",
          default: null,
          write: (id) => String(id),
          read: () => null,
        },
        sceneName: textAttr("", "name"),
      }),
    ).toThrow(/both cross the DOM as "name"/);
  });

  it("reads a list that will not parse as an empty one rather than throwing", () => {
    const element = document.createElement("div");
    element.setAttribute("data-tags", "not json at all");

    expect(() => SAMPLE_DOM.attributes.tags.parseHTML(element)).not.toThrow();
    expect(SAMPLE_DOM.attributes.tags.parseHTML(element)).toEqual([]);
  });
});

// ─── The blocks ───────────────────────────────────────────────────────────────

const schema: Schema = getSchema(noteExtensions());

/**
 * A node's attributes after the trip a copy-paste takes: out through `renderHTML` into an
 * element, and back in through `parseHTML`.
 *
 * Serialized and parsed with ProseMirror's own DOM machinery against the app's real
 * schema, so the element under test is the one the clipboard actually carries.
 */
function throughTheDOM(type: string, attrs: Record<string, unknown>): Record<string, unknown> {
  const node = schema.nodes[type].create(attrs);
  const host = document.createElement("div");
  host.appendChild(DOMSerializer.fromSchema(schema).serializeNode(node));

  const doc = DOMParser.fromSchema(schema).parse(host);
  const parsed = doc.firstChild;
  expect(parsed, `a ${type} parsed back out of ${host.innerHTML}`).not.toBeNull();
  expect(parsed!.type.name).toBe(type);
  return parsed!.attrs;
}

/**
 * One filled-in record per block that declares a DOM table, plus Image — whose record is
 * hand-declared against TipTap's own attributes and needs the same guarantee.
 *
 * Every field is set to something that is *not* its default, because a default that
 * survives by never having changed proves nothing: the loss this catches looks exactly
 * like a field coming back as its default.
 */
const RECORDS: [name: string, type: string, attrs: Record<string, unknown>][] = [
  [
    "an infobox",
    "infoboxBlock",
    {
      title: "Harbor's End",
      image: "images/harbor.png",
      imageAlt: "The harbour at [[dusk]]",
      rows: [
        { label: "Population", value: "4,200" },
        { label: "Ruler", value: "[[Captain Ash]]" },
      ],
    },
  ],
  [
    "a statblock",
    "statblockBlock",
    {
      name: "Goblin Skirmisher",
      rows: [{ label: "HP", value: "43/59" }],
      sections: [
        {
          heading: "Actions",
          entries: [{ name: "Scimitar", body: "+4 to hit, 1d6+2" }],
        },
      ],
      width: "narrow",
    },
  ],
  [
    "a timeline",
    "timelineBlock",
    {
      events: [
        {
          date: "3rd of Frostfall",
          title: "The Shattering",
          description: "Two lines.\n\nAnd a third.",
        },
      ],
    },
  ],
  ["a scene reference", "sceneBlock", { sceneId: 7, sceneName: "Boss Battle" }],
  [
    "an image",
    "image",
    {
      src: "images/map.png",
      alt: "A map of [[Harbor's End]]",
      align: "left",
      width: "60%",
      title: null,
    },
  ],
];

describe("a block copied inside the editor", () => {
  for (const [name, type, attrs] of RECORDS) {
    it(`carries every field of ${name} through the DOM and back`, () => {
      expect(throughTheDOM(type, attrs)).toMatchObject(attrs);
    });
  }
});
