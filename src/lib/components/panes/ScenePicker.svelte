<!-- src/lib/components/panes/ScenePicker.svelte
     Searchable picker over existing Scenes, each shown with its icon + colour chip in
     the hue its link will wear on the page. Used by the PDF "+ Link Scene" flow (both
     the selection bubble and the link bubble's change-Scene dropdown). A persistent
     "＋ New scene" footer creates an empty Scene and links it immediately, so a GM can
     attach a Scene to a passage before authoring its audio (issue #104).

     Keyboard: the search keeps focus; ↑/↓ move the highlighted row and Enter picks it,
     so typing "town" ⏎ links Town Market. The highlight is announced through
     `aria-activedescendant` rather than by moving focus out of the search. -->
<script lang="ts">
  import { Search, Plus, Check } from "@lucide/svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { sceneIcon, sceneLinkHue } from "./thumbnail-presets";
  import { wash } from "$lib/color";
  import { tick } from "svelte";

  let {
    currentSceneId = null,
    onSelect,
    onNewScene,
  }: {
    /** The scene a link already has, when re-linking — marked, and skipped as a pick. */
    currentSceneId?: number | null;
    onSelect: (sceneId: number) => void;
    onNewScene: () => void;
  } = $props();

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

  // Autofocus the search the moment the picker mounts.
  $effect(() => {
    void tick().then(() => inputEl?.focus());
  });

  function pick(i: number) {
    if (i < filtered.length) {
      if (filtered[i].id !== currentSceneId) onSelect(filtered[i].id);
    } else {
      onNewScene();
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
    }
  }

  const optionId = (i: number) => `${uid}-opt-${i}`;
</script>

<div class="w-64 rounded-lg border border-border bg-popover p-1.5 shadow-float select-none">
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
        {@const hue = sceneLinkHue(scene)}
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
                 {active === i ? 'bg-muted text-foreground' : 'text-muted-foreground'}"
        >
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-sm"
            style="background-color: {wash(hue, 0.18)}"
            aria-hidden="true"
          >
            <RowIcon class="size-3.5" style="color: {hue}" strokeWidth={1.75} />
          </span>
          <span class="flex-1 truncate text-sm font-medium">{scene.name}</span>
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
             {active === filtered.length ? 'bg-muted text-foreground' : 'text-muted-foreground'}"
    >
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded-sm border border-dashed border-border"
        aria-hidden="true"
      >
        <Plus class="size-3.5" />
      </span>
      <span class="text-sm font-medium">New scene</span>
    </button>
  </div>
</div>
