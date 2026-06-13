import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "$lib/utils";

// ─── parseFrontmatter ─────────────────────────────────────────────────────────
// Feeds the hover preview (frontmatter hidden from the excerpt) and tag reads.
// CRLF cases mirror the Rust-side frontmatter::split_frontmatter contract:
// Windows-authored vaults must parse identically to LF files.

describe("parseFrontmatter", () => {
  it("LF: extracts tags and strips the block from the body", () => {
    const { tags, body } = parseFrontmatter("---\ntags: [npc, allied]\n---\nBody text\n");
    expect(tags).toEqual(["npc", "allied"]);
    expect(body).toBe("Body text\n");
  });

  it("CRLF: extracts tags and strips the block from the body", () => {
    const { tags, body } = parseFrontmatter(
      "---\r\ntags: [npc, allied]\r\n---\r\nBody text\r\n",
    );
    expect(tags).toEqual(["npc", "allied"]);
    expect(body).toBe("Body text\r\n");
  });

  it("CRLF: block-form tags parse", () => {
    const { tags } = parseFrontmatter("---\r\ntags:\r\n  - npc\r\n  - allied\r\n---\r\nBody\r\n");
    expect(tags).toEqual(["npc", "allied"]);
  });

  it("no frontmatter: body passes through untouched", () => {
    const { tags, body } = parseFrontmatter("Just body\n");
    expect(tags).toEqual([]);
    expect(body).toBe("Just body\n");
  });

  it("unclosed frontmatter: treated as plain body", () => {
    const raw = "---\ntags: [npc]\nno closing delimiter";
    expect(parseFrontmatter(raw).body).toBe(raw);
  });
});
