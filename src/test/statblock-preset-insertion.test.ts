// `/statblock` and `/statblock <name>` end to end (#179) — the slash command, the
// store, the resolution rule and the document that comes out.
//
// The claim under test is that insertion is **silent and stamped**: no picker, no
// toast, and nothing in the note that points back at a preset.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { invoke } from "@tauri-apps/api/core";
import { noteExtensions } from "$lib/editor/note-extensions";
import { filterCommands } from "$lib/editor/slash-command";
import { statblockPresets } from "$lib/stores/statblock-presets.svelte";
import * as toast from "$lib/toast";

const GOBLIN_FENCE = "```statblock\n# Goblin\nHP: 7/7\nArmor Class: 15\n```";

function withStore(
  presets: { name: string; fence: string }[],
  def: string | null,
) {
  vi.mocked(invoke).mockImplementation(async (cmd: string) => {
    if (cmd === "list_statblock_presets") return presets;
    if (cmd === "get_statblock_preset_default") return def;
    return null;
  });
  return statblockPresets.reload();
}

/** Run `/statblock <argument>` into a fresh editor and hand back its markdown. */
async function stamp(
  argument: string,
): Promise<{ markdown: string; json: unknown }> {
  const ed = new Editor({ extensions: noteExtensions(), content: "<p></p>" });
  try {
    await filterCommands("statblock")[0].command(
      ed,
      { from: 1, to: 1 },
      argument,
    );
    return { markdown: ed.getMarkdown().trimEnd(), json: ed.getJSON() };
  } finally {
    ed.destroy();
  }
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue(null);
});

// ── No argument ──────────────────────────────────────────────────────────────

describe("/statblock", () => {
  it("stamps the vault's default with no prompt", async () => {
    await withStore([{ name: "Goblin", fence: GOBLIN_FENCE }], "Goblin");
    expect((await stamp("")).markdown).toBe(GOBLIN_FENCE);
  });

  it("stamps a blank statblock when there is no default", async () => {
    await withStore([{ name: "Goblin", fence: GOBLIN_FENCE }], null);
    expect((await stamp("")).markdown).toBe("```statblock\n```");
  });

  it("stamps a blank statblock silently when the default does not resolve", async () => {
    const error = vi.spyOn(toast, "toastError");
    const success = vi.spyOn(toast, "toastSuccess");
    await withStore([{ name: "Goblin", fence: GOBLIN_FENCE }], "Bugbear");

    expect((await stamp("")).markdown).toBe("```statblock\n```");
    // A toast fires mid-fight, where the GM cannot act on it. Settings reports instead.
    expect(error).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });
});

// ── With an argument ─────────────────────────────────────────────────────────

describe("/statblock <name>", () => {
  it("uses the argument's preset on an exact, case-insensitive match", async () => {
    await withStore([{ name: "Goblin", fence: GOBLIN_FENCE }], null);
    // The match was case-insensitive, so the title reads as the preset is named.
    expect((await stamp("goblin")).markdown).toBe(
      "```statblock\n# Goblin\nHP: 7/7\nArmor Class: 15\n```",
    );
  });

  // A miss lands on the shape the GM chose, titled with what they typed — one restamp
  // from fixed, where a loose match would have handed over a shape nobody asked for.
  it("falls through to the default's shape when the argument misses", async () => {
    await withStore([{ name: "Goblin", fence: GOBLIN_FENCE }], "Goblin");
    expect((await stamp("Bugbear")).markdown).toBe(
      "```statblock\n# Bugbear\nHP: 7/7\nArmor Class: 15\n```",
    );
  });

  it("stamps a blank statblock when the argument misses and there is no default", async () => {
    await withStore([{ name: "Goblin", fence: GOBLIN_FENCE }], null);
    expect((await stamp("Bugbear")).markdown).toBe(
      "```statblock\n# Bugbear\n```",
    );
  });

  it("does not match a preset by prefix — Orc must not shadow Orc Warlord", async () => {
    await withStore(
      [
        { name: "Orc", fence: "```statblock\nHP: 15/15\n```" },
        { name: "Orc Warlord", fence: "```statblock\nHP: 40/40\n```" },
      ],
      null,
    );
    expect((await stamp("Orc Warlord")).markdown).toBe(
      "```statblock\n# Orc Warlord\nHP: 40/40\n```",
    );
    expect((await stamp("Orc Warl")).markdown).toBe(
      "```statblock\n# Orc Warl\n```",
    );
  });

  it("can stamp a shipped preset by name", async () => {
    await withStore([], null);
    expect((await stamp("5e srd")).markdown).toContain("Armor Class:");
  });
});

// ── Copy on insert ───────────────────────────────────────────────────────────

describe("a stamped statblock", () => {
  it("holds no preset id or reference of any kind", async () => {
    await withStore([{ name: "Goblin", fence: GOBLIN_FENCE }], "Goblin");
    const { json, markdown } = await stamp("");

    expect(JSON.stringify(json)).not.toMatch(/preset/i);
    expect(markdown).not.toMatch(/preset/i);
  });

  it("is untouched by the preset being deleted afterwards", async () => {
    await withStore([{ name: "Goblin", fence: GOBLIN_FENCE }], "Goblin");
    const before = await stamp("");

    await withStore([], "Goblin");

    // The note's bytes are a copy — nothing re-resolves, so nothing can change.
    expect(before.markdown).toBe(GOBLIN_FENCE);
    expect((await stamp("")).markdown).toBe("```statblock\n```");
  });
});
