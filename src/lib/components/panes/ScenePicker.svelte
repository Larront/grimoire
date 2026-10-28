<!-- src/lib/components/panes/ScenePicker.svelte
     The one searchable picker over existing Scenes, wherever a GM chooses one: the PDF's
     Link Scene flow and its link bubble's change dropdown, and a note's scene block (its
     empty state and its change dropdown). The block used to draw a second picker of its
     own, which drifted — Metamorphous rows, a crimson hover, no keyboard. A persistent
     footer creates a Scene — named from the search when there is one — and binds it at
     once, so a GM can attach a Scene before authoring its audio (issue #104).

     Keyboard: the search keeps focus; ↑/↓ move the highlighted row and Enter picks it,
     so typing "town" ⏎ links Town Market. The highlight is announced through
     `aria-activedescendant` rather than by moving focus out of the search. -->
<script lang="ts">
  import MiddleTruncate from "$lib/components/MiddleTruncate.svelte";
  import { Search, Plus, Check } from "@lucide/svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { sceneIcon, sceneLinkHue, sceneThumbColors } from "./thumbnail-presets";
  import { wash } from "$lib/color";
  import { tick } from "svelte";

  let {
    currentSceneId = null,
    tint = "link",
    framed = true,
    autofocus = true,
    onSelect,
    onNewScene,
    onCancel,
  }: {
    /** The scene already chosen, when changing it — marked, and skipped as a pick. */
    currentSceneId?: number | null;
    /** Chip colours: the hue a PDF link wears (`link`), or the scene's own (`scene`),
        neutral when it has none. */
    tint?: "link" | "scene";
    /** Draw its own floating surface. Off where something else frames it. */
    framed?: boolean;
    autofocus?: boolean;
    /** Called with the search text (trimmed; may be empty) to name the new scene. */
    onNewScene: (name: string) => void;
    onSelect: (sceneId: number) => void;
    /** Escape. */
    onCancel?: () => void;
  } = $props();

  function chip(scene: { id: number; thumbnail_color: string | null }): { bg: string; fg: string } {
    if (tint === "scene") return sceneThumbColors(scene);
    const hue = sceneLinkHue(scene);
    return { bg: wash(hue, 0.18), fg: hue };
  }

  const uid = $props.id();
  let query = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);
  let active = $state(0);

  const filtered = $derived(
    scenes.scenes.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())),
  );
  // The rows plus "New scene" at the end, as one list the arrows move through.
  const count = $derived(filtered.length + 1);

  $effect(() => {
    void query;
    active = 0;
  });

  // Focus the search once the picker is up. A frame later rather than on mount: inside a
  // popover, the popover focuses its own panel as it opens and would take focus back.
  $effect(() => {
    if (!autofocus) return;
    void tick().then(() => requestAnimationFrame(() => inputEl?.focus()));
  });

  function pick(i: number) {
    if (i < filtered.length) {
      if (filtered[i].id !== currentSceneId) onSelect(filtered[i].id);
    } else {
      onNewScene(query.trim());
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (active + 1) % count;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (active - 1 + count) % count;
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  }

  const optionId = (i: number) => `${uid}-opt-${i}`;
</script>

<div
  class="select-none {framed
    ? 'w-64 rounded-lg border border-border bg-popover p-1.5 shadow-float'
    : 'w-full'}"
>
  <div class="relative mb-1.5">
    <Search
      class="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground"
    />
    <input
      bind:this={inputEl}
      type="text"
      role="combobox"
      aria-expanded="true"
      aria-controls="{uid}-list"
      aria-activedescendant={optionId(active)}
      aria-label="Search scenes"
      placeholder="Search scenes…"
      bind:value={query}
      onkeydown={onKeydown}
      class="w-full rounded-md border border-border bg-background py-1 pr-2 pl-6 font-sans text-xs
             text-foreground placeholder:text-muted-foreground transition-colors
             focus:border-ring focus:outline-none"
    />
  </div>

  <div id="{uid}-list" class="flex max-h-56 flex-col overflow-y-auto" role="listbox" aria-label="Scenes">
    {#if scenes.scenes.length === 0}
      <p class="px-2 py-2 font-sans text-xs text-muted-foreground">
        No scenes yet — create one below.
      </p>
    {:else if filtered.length === 0}
      <p class="px-2 py-2 font-sans text-xs text-muted-foreground">No scenes match.</p>
    {:else}
      {#each filtered as scene, i (scene.id)}
        {@const RowIcon = sceneIcon(scene)}
        {@const colors = chip(scene)}
        {@const current = scene.id === currentSceneId}
        <!-- Each scene in the hue its link will wear on the page, so the GM sees the
             pairing while choosing. -->
        <button
          id={optionId(i)}
          type="button"
          role="option"
          aria-selected={current}
          tabindex="-1"
          onclick={() => pick(i)}
          onmousemove={() => (active = i)}
          class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors
                 {active === i ? 'bg-surface-selected text-foreground' : 'text-muted-foreground'}"
        >
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-sm"
            style="background-color: {colors.bg}"
            aria-hidden="true"
          >
            <RowIcon class="size-3.5" style="color: {colors.fg}" strokeWidth={1.75} />
          </span>
          <MiddleTruncate text={scene.name} class="flex-1 text-sm font-medium" />
          {#if current}
            <Check class="size-3.5 shrink-0 text-primary" aria-hidden="true" />
          {/if}
        </button>
      {/each}
    {/if}
  </div>

  <!-- ＋ New scene: create an empty Scene and link it immediately; it opens beside the
       PDF with its name selected, ready to be named. -->
  <div class="mt-1.5 border-t border-border pt-1.5">
    <button
      id={optionId(filtered.length)}
      type="button"
      role="option"
      aria-selected="false"
      tabindex="-1"
      onclick={() => pick(filtered.length)}
      onmousemove={() => (active = filtered.length)}
      class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors
             {active === filtered.length ? 'bg-surface-selected text-foreground' : 'text-muted-foreground'}"
    >
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded-sm border border-dashed border-border"
        aria-hidden="true"
      >
        <Plus class="size-3.5" />
      </span>
      <span class="truncate text-sm font-medium">
        {query.trim() ? `Create “${query.trim()}”` : "New scene"}
      </span>
    </button>
  </div>
</div>
