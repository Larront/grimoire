// The Templates dialog (2026-10 design review): where a GM opens, renames, deletes
// and makes templates, since the sidebar footer list went. Driven through the shell
// over a mocked `invoke`, as the Tag Manager's tests are.
import { render, fireEvent, cleanup, within, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import AppShell from "../lib/components/AppShell.svelte";
import { dialogs } from "../lib/stores/overlay.svelte";
import { tabs } from "../lib/stores/tabs.svelte";
import * as toast from "$lib/toast";
import type { TemplateEntry } from "../lib/types/ledger";

afterEach(() => {
  cleanup();
  dialogs.templatesOpen = false;
  dialogs.templatesNaming = false;
  tabs.closeAll("left");
  tabs.closeAll("right");
  vi.restoreAllMocks();
  vi.mocked(invoke).mockResolvedValue(null);
});

const entry = (name: string, tags: string[] = []): TemplateEntry => ({
  display_name: name,
  path: `.grimoire/templates/${name}.md`,
  tags,
});

function mockTemplates(list: TemplateEntry[], extra: (cmd: string, args: any) => unknown = () => null) {
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
    if (cmd === "list_templates") return list;
    return extra(cmd, args);
  });
}

async function openDialog(list: TemplateEntry[], extra?: (cmd: string, args: any) => unknown) {
  mockTemplates(list, extra);
  render(AppShell);
  dialogs.templatesOpen = true;
  return waitFor(() => {
    const el = document.body.querySelector<HTMLElement>('[data-testid="templates-dialog"]');
    if (!el) throw new Error("dialog not found");
    if (list.length && !el.querySelector('[data-testid="template-row"]'))
      throw new Error("rows not rendered");
    return el;
  });
}

/** The names in the list, in order — each row's first titled span is its name. */
const rowNames = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll('[data-testid="template-row"]')].map((row) =>
    row.querySelector("[data-row-open] span[title]")?.getAttribute("title"),
  );

/** Catch the undo toast without letting its real timer delete anything later. */
const spyUndo = () => vi.spyOn(toast, "toastUndo").mockImplementation(() => {});

async function chooseFromMenu(dialog: HTMLElement, name: string, item: RegExp) {
  await fireEvent.pointerDown(within(dialog).getByTestId(`template-menu-${name}`), {
    button: 0,
    pointerType: "mouse",
  });
  const found = await waitFor(() => {
    const hit = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) =>
      item.test(el.textContent ?? ""),
    );
    if (!hit) throw new Error(`menu item ${item} not found`);
    return hit;
  });
  await fireEvent.click(found);
}

const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd);

describe("Templates dialog", () => {
  it("lists templates in reading order, each with the tags it gives a note", async () => {
    const dialog = await openDialog([
      entry("Annal 10"),
      entry("bandit camp", ["faction"]),
      entry("Annal 2"),
      entry("NPC", ["npc"]),
    ]);

    expect(rowNames(dialog)).toEqual(["Annal 2", "Annal 10", "bandit camp", "NPC"]);
    expect(within(dialog).getByTestId("template-open-NPC").textContent).toContain("npc");
  });

  it("opens a template in a tab when its row is chosen, and gets out of the way", async () => {
    const dialog = await openDialog([entry("NPC", ["npc"])]);

    await fireEvent.click(within(dialog).getByTestId("template-open-NPC"));

    expect(dialogs.templatesOpen).toBe(false);
    expect(tabs.activeTab).toEqual(
      expect.objectContaining({ type: "template", templatePath: ".grimoire/templates/NPC.md" }),
    );
  });

  it("names a new template before making it, and says why a name won't do", async () => {
    const made = entry("Faction");
    const dialog = await openDialog([entry("NPC")], (cmd) =>
      cmd === "create_template" ? made : null,
    );

    await fireEvent.click(within(dialog).getByTestId("template-new"));
    const input = (await waitFor(() =>
      within(dialog).getByTestId("template-name-input"),
    )) as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    await fireEvent.input(input, { target: { value: "Who? What" } });
    expect(dialog.textContent).toContain("A name can't contain");
    expect((within(dialog).getByTestId("template-name-apply") as HTMLButtonElement).disabled).toBe(
      true,
    );

    await fireEvent.input(input, { target: { value: "npc" } });
    expect(dialog.textContent).toContain("There's already a template called “NPC”.");

    await fireEvent.input(input, { target: { value: "Faction" } });
    await fireEvent.submit(input.form!);

    await waitFor(() => expect(calls("create_template")).toEqual([["create_template", { name: "Faction" }]]));
    await waitFor(() => expect(tabs.activeTab?.templatePath).toBe(made.path));
    expect(dialogs.templatesOpen).toBe(false);
  });

  it("opens at the name field when asked to make one", async () => {
    mockTemplates([]);
    render(AppShell);
    dialogs.templatesNaming = true;
    dialogs.templatesOpen = true;

    const input = await waitFor(() => {
      const el = document.body.querySelector<HTMLInputElement>('[data-testid="template-name-input"]');
      if (!el) throw new Error("name field not shown");
      return el;
    });
    expect(input.value).toBe("");
  });

  it("keeps a refused rename typed, with the reason under it", async () => {
    const dialog = await openDialog([entry("NPC"), entry("Location")], (cmd) => {
      if (cmd === "rename_template") throw "ERR_NAME_TAKEN: A template named 'Town' already exists";
      return null;
    });

    await chooseFromMenu(dialog, "NPC", /Rename/);
    const input = (await waitFor(() =>
      within(dialog).getByTestId("template-name-input"),
    )) as HTMLInputElement;
    expect(input.value).toBe("NPC");

    await fireEvent.input(input, { target: { value: "Town" } });
    await fireEvent.submit(input.form!);

    await waitFor(() => expect(dialog.textContent).toContain("That name is already taken."));
    expect((within(dialog).getByTestId("template-name-input") as HTMLInputElement).value).toBe(
      "Town",
    );
  });

  it("renames in place and keeps an open tab pointing at the renamed file", async () => {
    tabs.openTab({ type: "template", id: 0, title: "NPC", templatePath: ".grimoire/templates/NPC.md" });
    const dialog = await openDialog([entry("NPC")]);

    await chooseFromMenu(dialog, "NPC", /Rename/);
    const input = (await waitFor(() =>
      within(dialog).getByTestId("template-name-input"),
    )) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "Character" } });
    await fireEvent.submit(input.form!);

    await waitFor(() =>
      expect(calls("rename_template")).toEqual([
        ["rename_template", { path: ".grimoire/templates/NPC.md", newName: "Character" }],
      ]),
    );
    expect(tabs.left.tabs[0]).toEqual(
      expect.objectContaining({ title: "Character", templatePath: ".grimoire/templates/Character.md" }),
    );
  });

  it("deletes at once with Undo, and closes the template's tab only when it is really gone", async () => {
    const undo = spyUndo();
    tabs.openTab({ type: "template", id: 0, title: "NPC", templatePath: ".grimoire/templates/NPC.md" });
    const dialog = await openDialog([entry("NPC"), entry("Location")]);

    await chooseFromMenu(dialog, "NPC", /Delete/);

    expect(undo.mock.calls[0][0]).toBe("Deleted “NPC”");
    // Gone from the list on click, not after the window…
    await waitFor(() => expect(rowNames(dialog)).toEqual(["Location"]));
    // …but nothing is deleted, and the tab stays, until the window elapses.
    expect(calls("delete_template")).toHaveLength(0);
    expect(tabs.left.tabs).toHaveLength(1);

    await undo.mock.calls[0][1]();

    expect(calls("delete_template")).toEqual([
      ["delete_template", { path: ".grimoire/templates/NPC.md" }],
    ]);
    expect(tabs.left.tabs).toHaveLength(0);
  });

  it("puts a deleted template back on Undo", async () => {
    const undo = spyUndo();
    const dialog = await openDialog([entry("NPC"), entry("Location")]);

    await chooseFromMenu(dialog, "NPC", /Delete/);
    await waitFor(() => expect(rowNames(dialog)).toEqual(["Location"]));
    undo.mock.calls[0][2]!();

    await waitFor(() => expect(rowNames(dialog)).toEqual(["Location", "NPC"]));
    expect(calls("delete_template")).toHaveLength(0);
  });

  it("says when a world has no templates yet", async () => {
    const dialog = await openDialog([]);
    await waitFor(() => within(dialog).getByTestId("templates-empty"));
  });
});
