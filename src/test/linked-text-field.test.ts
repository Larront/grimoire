// The Linked Text Field (#156, #175) — the one text surface a Note Block has for a
// free-text value, tested as the GM meets it: what is drawn, what a click does, and
// what reaches the document.
//
// The Link Resolver is stubbed here rather than exercised. Its own rule — a target
// matches a path, else an alias — is pinned in link-resolver.svelte.test.ts, and what
// this file needs is a *decided* answer so the stub-vs-resolved marker is assertable
// rather than a race with a lookup.
import { render, fireEvent, cleanup } from "@testing-library/svelte";
import { describe, it, expect, afterEach, vi } from "vitest";
import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
import linkedTextSource from "$lib/editor/linked-text.ts?raw";
import fieldSource from "$lib/components/editor/LinkedTextField.svelte?raw";
import infoboxViewSource from "$lib/components/editor/InfoboxBlockView.svelte?raw";
import { labelText } from "$lib/editor/labelled-row";

vi.mock("$lib/stores/link-resolver.svelte", () => ({
  linkResolver: {
    // Everything resolves except a note called Missing.
    isKnown: (target: string) => target !== "Missing",
    prime: vi.fn(),
    resolve: vi.fn(),
  },
}));

const SEARCH_RESULTS = [
  { id: 1, title: "Captain Ash", path: "People/Ash.md" },
  { id: 2, title: "Ashfall Vale", path: "Places/Ashfall Vale.md" },
];

vi.mock("$lib/api", () => ({
  api: { searchNotes: vi.fn(async () => SEARCH_RESULTS) },
}));

afterEach(cleanup);

function field(props: Partial<Record<string, unknown>> = {}) {
  const onCommit = vi.fn();
  const rendered = render(LinkedTextField, {
    props: { value: "", onCommit, ariaLabel: "Value", ...props },
  });
  return { ...rendered, onCommit };
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

describe("a Linked Text Field draws its value", () => {
  it("draws plain text as itself", () => {
    const { getByLabelText } = field({ value: "4,200" });
    expect(getByLabelText("Value")).toHaveTextContent("4,200");
  });

  it("draws a placeholder for an empty value", () => {
    const { getByLabelText } = field({ value: "", placeholder: "Value" });
    expect(getByLabelText("Value")).toHaveTextContent("Value");
  });

  it("draws a wikilink as a link the host surface can act on", () => {
    // The field delegates: it draws the attributes Editor.svelte's own click and
    // hover handlers already read, and knows nothing about opening a note.
    const { container } = field({ value: "ruled by [[Captain Ash]]" });
    const link = container.querySelector("[data-wiki-link]");

    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("data-path", "Captain Ash");
    expect(link).toHaveAttribute("data-title", "Captain Ash");
    expect(link).toHaveTextContent("Captain Ash");
  });

  it("draws the text around a link as text", () => {
    const { getByLabelText } = field({
      value: "ruled by [[Captain Ash]] since 812",
    });
    expect(getByLabelText("Value")).toHaveTextContent("ruled by Captain Ash since 812");
  });

  it("draws an aliased link under its alias and navigates by its path", () => {
    const { container } = field({ value: "[[People/Ash.md|the Captain]]" });
    const link = container.querySelector("[data-wiki-link]");

    expect(link).toHaveTextContent("the Captain");
    expect(link).toHaveAttribute("data-path", "People/Ash.md");
  });

  it("marks a link that resolves to nothing as a stub", () => {
    const { container } = field({ value: "[[Missing]]" });
    expect(container.querySelector("[data-wiki-link]")).toHaveAttribute("data-broken");
  });

  it("leaves a link that resolves unmarked", () => {
    const { container } = field({ value: "[[Captain Ash]]" });
    expect(container.querySelector("[data-wiki-link]")).not.toHaveAttribute("data-broken");
  });

  it("draws two links in one value", () => {
    const { container } = field({ value: "[[Ash]] and [[Vale]]" });
    expect(container.querySelectorAll("[data-wiki-link]")).toHaveLength(2);
  });

  it("draws markup as the characters the GM typed", () => {
    // The proof that nothing here builds an HTML string: a value holding a tag shows
    // the tag. There is no escaper to get wrong, because there is nothing to escape.
    const { container, getByLabelText } = field({ value: "<b>Ash</b> & co" });

    expect(getByLabelText("Value")).toHaveTextContent("<b>Ash</b> & co");
    expect(container.querySelector("b")).toBeNull();
  });
});

// ─── Editing ──────────────────────────────────────────────────────────────────

describe("a Linked Text Field is directly editable", () => {
  it("swaps in an input when the GM clicks it", async () => {
    const { getByLabelText } = field({ value: "4,200" });
    await fireEvent.click(getByLabelText("Value"));

    expect(getByLabelText("Value")).toHaveValue("4,200");
  });

  it("commits the edited value when focus leaves", async () => {
    const { getByLabelText, onCommit } = field({ value: "4,200" });
    await fireEvent.click(getByLabelText("Value"));

    const input = getByLabelText("Value");
    await fireEvent.input(input, { target: { value: "4,300" } });
    await fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith("4,300");
  });

  it("commits on Enter", async () => {
    const { getByLabelText, onCommit } = field({ value: "4,200" });
    await fireEvent.click(getByLabelText("Value"));
    await fireEvent.input(getByLabelText("Value"), {
      target: { value: "4,300" },
    });
    await fireEvent.keyDown(getByLabelText("Value"), { key: "Enter" });

    expect(onCommit).toHaveBeenCalledWith("4,300");
  });

  it("commits nothing when the value did not change", async () => {
    const { getByLabelText, onCommit } = field({ value: "4,200" });
    await fireEvent.click(getByLabelText("Value"));
    await fireEvent.blur(getByLabelText("Value"));

    expect(onCommit).not.toHaveBeenCalled();
  });

  it("abandons the edit on Escape", async () => {
    const { getByLabelText, onCommit } = field({ value: "4,200" });
    await fireEvent.click(getByLabelText("Value"));
    await fireEvent.input(getByLabelText("Value"), {
      target: { value: "nonsense" },
    });
    await fireEvent.keyDown(getByLabelText("Value"), { key: "Escape" });

    expect(onCommit).not.toHaveBeenCalled();
    expect(getByLabelText("Value")).toHaveTextContent("4,200");
  });

  it("leaves a click on a link to the host surface rather than opening for typing", async () => {
    // Clicking a link means "go there". If this opened the field instead, a link
    // inside a block would be the one link in the app that cannot be followed.
    const { container, getByLabelText } = field({ value: "[[Captain Ash]]" });
    await fireEvent.click(container.querySelector("[data-wiki-link]")!);

    expect(getByLabelText("Value").tagName).toBe("BUTTON");
  });

  it("opens for typing when a block focuses it", async () => {
    // How a freshly inserted row lands with the caret already in it.
    const { getByLabelText } = field({ value: "", focused: true });
    expect(getByLabelText("Value").tagName).toBe("INPUT");
  });

  it("holds the value to what the format can represent as the GM types", async () => {
    // A label's colon is the Labelled Row's separator, so the field that edits one
    // never lets a colon in — the restriction is the format's, applied at the field.
    const { getByLabelText, onCommit } = field({
      value: "Ruler",
      restrict: labelText,
    });
    await fireEvent.click(getByLabelText("Value"));
    await fireEvent.input(getByLabelText("Value"), {
      target: { value: "Ruler: styled" },
    });
    await fireEvent.blur(getByLabelText("Value"));

    expect(onCommit).toHaveBeenCalledWith("Ruler styled");
  });
});

// ─── Autocomplete ─────────────────────────────────────────────────────────────
//
// The spec's boundary: spotting `[[` is per-surface, everything after it is one
// shared dropdown — the same `WikiLinkSuggestion` the wikilink node draws.

describe("typing [[ in a field offers notes to link", () => {
  async function openSuggestions(value = "Ruled by [[") {
    const rendered = field({ value: "Ruled by " });
    await fireEvent.click(rendered.getByLabelText("Value"));
    await fireEvent.input(rendered.getByLabelText("Value"), {
      target: { value },
    });
    // The lookup is awaited inside the handler, so let its promise settle.
    await Promise.resolve();
    await Promise.resolve();
    return rendered;
  }

  it("shows the notes a query matches", async () => {
    const { getByRole, getByText } = await openSuggestions();

    expect(getByRole("listbox")).toBeInTheDocument();
    expect(getByText("Captain Ash")).toBeInTheDocument();
  });

  it("puts the chosen note in as a wikilink", async () => {
    const { getByText, getByLabelText, onCommit } = await openSuggestions();
    await fireEvent.click(getByText("Captain Ash"));
    await fireEvent.blur(getByLabelText("Value"));

    expect(onCommit).toHaveBeenCalledWith("Ruled by [[People/Ash.md]]");
  });

  it("takes the selected note on Enter rather than committing the field", async () => {
    const { getByLabelText, onCommit } = await openSuggestions();
    await fireEvent.keyDown(getByLabelText("Value"), { key: "Enter" });

    expect(onCommit).not.toHaveBeenCalled();
    expect(getByLabelText("Value")).toHaveValue("Ruled by [[People/Ash.md]]");
  });

  it("moves through the list with the arrow keys", async () => {
    const { getByLabelText } = await openSuggestions();
    await fireEvent.keyDown(getByLabelText("Value"), { key: "ArrowDown" });
    await fireEvent.keyDown(getByLabelText("Value"), { key: "Enter" });

    expect(getByLabelText("Value")).toHaveValue("Ruled by [[Places/Ashfall Vale.md]]");
  });

  it("closes the dropdown on Escape and keeps the edit", async () => {
    // One Escape, one dismissal: the dropdown goes and the field stays open.
    const { queryByRole, getByLabelText } = await openSuggestions();
    await fireEvent.keyDown(getByLabelText("Value"), { key: "Escape" });

    expect(queryByRole("listbox")).toBeNull();
    expect(getByLabelText("Value").tagName).toBe("INPUT");
  });

  it("offers nothing once the GM has closed the brackets themselves", async () => {
    const { queryByRole } = await openSuggestions("Ruled by [[Captain Ash]]");
    expect(queryByRole("listbox")).toBeNull();
  });
});

// ─── No HTML strings ──────────────────────────────────────────────────────────

describe("nothing in the field's path builds an HTML string", () => {
  // The acceptance criterion is about the *path*, not one function: the behavioural
  // proof above (markup drawn as characters) holds for the values a test thought of,
  // and this holds for the ones it did not. `{@html}` is the only way a Svelte
  // component can render markup, so its absence is the property itself.
  // A real `{@html expr}` is followed by whitespace or an opening paren; the bare
  // `{@html}` a comment writes when *naming* the tag is not matched.
  const HTML_TAG = /\{@html[\s(]/;

  it.each([
    ["the splitting rule", linkedTextSource],
    ["the field", fieldSource],
    ["the Infobox's view", infoboxViewSource],
  ])("%s renders no HTML string", (_what, source) => {
    expect(source).not.toMatch(HTML_TAG);
  });
});
