<script lang="ts">
  // The Callout's view (#181) — the pattern's **container exemplar**, and the first
  // block whose children ProseMirror owns.
  //
  // Everything below the header is a hole: `data-node-view-content` is where the shared
  // connector hangs ProseMirror's `contentDOM`, so the body's paragraphs, lists, fences
  // and nested callouts are ordinary document content edited in place. Nothing here
  // knows what is inside it, which is what makes a callout the GM's fight-grouping
  // vehicle (#151) rather than a special-purpose widget.
  //
  // What the block owns is the header, and it is why a real node view was forced (ADR-0016
  // §5): a title that is a **Linked Text Field** cannot be typed into without a component,
  // and its wikilinks need structured segments rather than an HTML string. A heading a GM
  // cannot click and type into would be worse than the plain quote it replaces.
  //
  // Directly editable, no mode (ADR-0016 §6): a callout is prose, and a pencil button
  // before typing into an aside would be absurd. The one piece of chrome that is not a
  // field is the collapse chevron, and collapse is **view state** — it never reaches the
  // file, in either direction. Obsidian's fold marker seeds it and is otherwise a no-op.
  import { ChevronDown } from "@lucide/svelte";
  import { BLOCK_ICONS } from "$lib/components/editor/block-icons";
  import LinkedTextField from "$lib/components/editor/LinkedTextField.svelte";
  import { oneLine } from "$lib/editor/labelled-row";
  import {
    isInitiallyCollapsed,
    recognisedCalloutType,
    titleCaseCalloutType,
    type CalloutAttrs,
  } from "$lib/editor/callout-block";

  let {
    calloutType = null,
    calloutTitle = null,
    foldMarker = null,
    onTitleCommit,
    onCollapse,
  }: {
    calloutType?: string | null;
    calloutTitle?: string | null;
    foldMarker?: string | null;
    /** The edited title, `null` when the GM cleared it back to nothing. */
    onTitleCommit: (title: string | null) => void;
    /**
     * Called as the body is hidden, so the caret is not left inside it. Nothing about
     * the document changes — this is view state asking the editor to look away.
     */
    onCollapse?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let _type = $state(calloutType);
  // svelte-ignore state_referenced_locally
  let _title = $state(calloutTitle);

  // Seeded once from the file's fold marker and never written back: `-` is an authored
  // *starting* state (#180). A later attribute change must not re-fold a box the GM
  // opened, so `setAttrs` leaves this alone.
  // svelte-ignore state_referenced_locally
  let collapsed = $state(isInitiallyCollapsed({ foldMarker }));

  const known = $derived(recognisedCalloutType(_type));

  // Only a recognised type has an icon: an unrecognised one is drawn neutrally, and
  // that includes having none. The name comes off `CALLOUT_TYPES`, so the vocabulary
  // is still declared in exactly one place.
  const icon = $derived(known ? BLOCK_ICONS[known.icon] : null);

  /**
   * What the header shows when the GM wrote no title: the type word in title case.
   *
   * It is the field's *placeholder* rather than its value, which is the whole of how
   * the displayed fallback is kept out of the file — there is no path by which typing
   * near it writes `Warning` into `> [!warning]`. It also reads as what it is: faded,
   * so a GM can see the box is unnamed and click to name it.
   */
  const fallback = $derived(_type ? titleCaseCalloutType(_type) : "");

  /**
   * Collapsing hides real document content, so the caret must not still be in it — a
   * caret inside a hidden body would type invisibly, editing a note the GM cannot see.
   * Expanding needs no such care.
   */
  function toggleCollapsed() {
    collapsed = !collapsed;
    if (collapsed) onCollapse?.();
  }

  function setTitle(next: string) {
    // An emptied field is an *absent* title, not an empty one — the header line then
    // writes `> [!warning]` with nothing after the marker.
    _title = next || null;
    onTitleCommit(_title);
  }

  export function setAttrs(attrs: CalloutAttrs) {
    _type = attrs.calloutType;
    _title = attrs.calloutTitle;
  }
</script>

<!-- A real `<blockquote>`, drawn by the component rather than by the connector's
     wrapper, so #180's stylesheet keeps matching: `[data-callout]` paints the callout
     and a quote with no type is styled as the ordinary quote it is. -->
<blockquote
  class="callout-block"
  data-callout={_type ?? undefined}
  data-callout-known={known ? "" : undefined}
>
  {#if _type}
    <!-- Chrome, not content: `contenteditable="false"` keeps the caret out, and the
         connector's default event handling already gives every event in here to the
         block rather than to ProseMirror — which is the event swallowing the title
         input needs, inherited rather than hand-rolled. -->
    <header class="callout-header" contenteditable="false">
      {#if icon}
        {@const Icon = icon}
        <Icon size={14} class="callout-icon shrink-0" aria-hidden="true" />
      {/if}

      <LinkedTextField
        value={_title ?? ""}
        onCommit={setTitle}
        restrict={oneLine}
        ariaLabel="Callout title"
        placeholder={fallback}
        class="callout-title"
      />

      <button
        type="button"
        class="callout-toggle shrink-0 rounded p-0.5 transition-colors motion-reduce:transition-none
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={collapsed ? "Expand callout" : "Collapse callout"}
        aria-expanded={!collapsed}
        onclick={toggleCollapsed}
      >
        <ChevronDown
          size={14}
          class="transition-transform duration-150 motion-reduce:transition-none {collapsed
            ? '-rotate-90'
            : ''}"
        />
      </button>
    </header>
  {/if}

  <!-- ProseMirror's hole. Hidden rather than unmounted when collapsed: the children are
       real document content, and a collapse that removed them from the DOM would be a
       collapse that edited the note. -->
  <div class="callout-body" data-node-view-content hidden={collapsed}></div>
</blockquote>
