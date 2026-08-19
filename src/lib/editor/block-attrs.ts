// How a Note Block's record crosses the DOM — declared once per block, in one table.
//
// A block's attributes are a record it already has a type for (`Infobox`,
// `Statblock`, `SceneRef`), and that record has to survive three separate journeys:
// the schema's defaults, the `data-*` attributes `renderHTML` writes, and the read
// back through `parseHTML`. A block copied *inside* the editor travels as HTML rather
// than as markdown, so the last two are not decoration: an attribute that only writes
// is an attribute a copy-paste drops.
//
// Those three used to be three hand-written enumerations of the same field names, none
// of them checked against the record and none against each other (#209). A field
// forgotten in any one of them fails **silently** — the value is simply not there on
// the other side, and the note's next autosave writes the loss into the GM's file.
//
// So each block declares one table instead, `blockDom<R>()`, and the three journeys are
// projections of it. The table is total by construction: `BlockDom<R>` demands an entry
// per field of `R`, so adding an attribute to the record is a type error until the table
// names it, and nothing downstream needs editing at all.
//
// Deliberately *not* a registry (ADR-0016 §3): nothing collects these, every block still
// declares its own and hands it to its own `addAttributes` and `renderHTML`. Two blocks
// stay outside it and stay hand-written, because their DOM form is not a dataset of its
// record: Image writes real `src`/`alt` attributes inherited from TipTap's own extension,
// and Callout writes `data-callout`, which #180's stylesheet matches.

// ─── One field's crossing ─────────────────────────────────────────────────────

/**
 * How one field of a block's record crosses the DOM: what it is when absent, where it
 * is written, and how it is spelled in each direction.
 */
export interface BlockAttr<T> {
  /** The value the schema stands in when the node carries none. */
  default: T;
  /**
   * The `dataset` key it lives under, when that is not the field's own name — so
   * Scene's `sceneId` can keep the `data-id` it has always written.
   */
  dataset?: string;
  /** The value as a dataset entry. */
  write: (value: T) => string;
  /**
   * The value back off a dataset entry — absent, empty and unreadable included.
   *
   * Never throws: the caller is ProseMirror parsing pasted HTML, where a block that
   * comes back with one field defaulted is recoverable and an exception reaching the
   * schema is not.
   */
  read: (raw: string | undefined) => T;
}

/**
 * A block's whole crossing: one entry per field of its record, none of them optional.
 *
 * `-?` is the point of the type. An optional entry would let a field be declared in
 * the record and forgotten here, which is the silent loss this table exists to make
 * impossible.
 */
export type BlockDom<R extends object> = {
  [K in keyof R]-?: BlockAttr<R[K]>;
};

// ─── Field kinds ──────────────────────────────────────────────────────────────

/** A plain string field, absent reading as `fallback`. */
export function textAttr(fallback = "", dataset?: string): BlockAttr<string> {
  return {
    default: fallback,
    dataset,
    write: (value) => value ?? "",
    read: (raw) => raw ?? fallback,
  };
}

/**
 * A list field — Timeline's events, an Infobox's rows, a Statblock's rows and
 * sections — carried as one entry of URI-encoded JSON.
 *
 * Encoded rather than written out because a dataset entry is a single HTML attribute
 * value and a GM's row holds anything they typed. An unreadable entry reads as the
 * empty list for the reason `read` states: a panel drawn with no rows is recoverable,
 * a parse error reaching the schema is not.
 */
export function listAttr<T>(dataset?: string): BlockAttr<T[]> {
  return {
    default: [],
    dataset,
    write: (value) => encodeURIComponent(JSON.stringify(value ?? [])),
    read: (raw) => {
      try {
        const parsed = JSON.parse(decodeURIComponent(raw ?? "[]"));
        return Array.isArray(parsed) ? (parsed as T[]) : [];
      } catch {
        return [];
      }
    },
  };
}

// ─── The three projections ────────────────────────────────────────────────────

/** One attribute as TipTap's `addAttributes()` describes it. */
interface NodeAttrSpec {
  default: unknown;
  parseHTML: (element: HTMLElement) => unknown;
}

/**
 * A block's record as the three things that have to agree about it.
 *
 * The block hands `attributes` to `addAttributes()`, calls `dataset(node.attrs)` inside
 * `renderHTML()`, and hands `defaults` to the node-view connector as its stand-ins. All
 * three are the one table read three ways, so none of them can drift from the record or
 * from each other.
 */
export interface BlockDomProjections<R extends object> {
  /** The schema's attribute declarations, `parseHTML` included. */
  attributes: Record<string, NodeAttrSpec>;
  /** The `data-*` attributes a node's record writes. */
  dataset: (attrs: R) => Record<string, string>;
  /** The stand-in for every field, which is the same default the schema declares. */
  defaults: R;
}

/** `imageAlt` → `data-image-alt`, which is how `dataset` spells the same entry. */
function dataAttrName(key: string): string {
  return `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** A block's record read three ways — see `BlockDomProjections`. */
export function blockDom<R extends object>(
  dom: BlockDom<R>,
): BlockDomProjections<R> {
  const fields = Object.entries(dom) as [keyof R & string, BlockAttr<unknown>][];

  const attributes: Record<string, NodeAttrSpec> = {};
  const defaults: Record<string, unknown> = {};
  const claimed = new Set<string>();
  for (const [field, attr] of fields) {
    const key = attr.dataset ?? field;
    // The one mistake the table's type cannot catch: two fields naming one entry, where
    // the second silently overwrites the first on the way out and both read the same value
    // back. Thrown at module load, so a block whose table does this cannot ship.
    if (claimed.has(key)) {
      throw new Error(
        `Two fields of this block's record both cross the DOM as "${key}" — ` +
          `give one of them its own dataset name`,
      );
    }
    claimed.add(key);
    attributes[field] = {
      default: attr.default,
      parseHTML: (element) => attr.read(element.dataset[key]),
    };
    defaults[field] = attr.default;
  }

  return {
    attributes,
    dataset: (attrs) => {
      const out: Record<string, string> = {};
      for (const [field, attr] of fields) {
        out[dataAttrName(attr.dataset ?? field)] = attr.write(
          (attrs as Record<string, unknown>)[field],
        );
      }
      return out;
    },
    defaults: defaults as R,
  };
}
