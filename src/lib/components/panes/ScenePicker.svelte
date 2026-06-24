<!-- src/lib/components/panes/ScenePicker.svelte
     Searchable picker over existing Scenes, each shown with its icon + color
     chip. Used by the PDF "+ Link Scene" flow (both the selection bubble and the
     hover toolbar's change-Scene dropdown). A persistent "＋ New scene" footer
     creates an empty Scene and links it immediately, so a GM can attach a Scene to
     a passage before authoring its audio (issue #104). -->
<script lang="ts">
  import { Search, Music2, Plus } from "@lucide/svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { ICON_MAP, ACCENT_BG, ACCENT_FG } from "./thumbnail-presets";
  import { tick } from "svelte";

  let {
    onSelect,
    onNewScene,
  }: {
    onSelect: (sceneId: number) => void;
    onNewScene: () => void;
  } = $props();

  let query = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);

  const filtered = $derived(
    scenes.scenes.filter((s) => s.name.toLowerCase().includes(query.toLowerCase())),
  );

  // Autofocus the search the moment the picker mounts.
  $effect(() => {
    void tick().then(() => inputEl?.focus());
  });
</script>

<div class="w-64 rounded-lg border border-border bg-popover p-1.5 shadow-lg select-none">
  <div class="relative mb-1.5">
    <Search
      class="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/50 pointer-events-none"
    />
    <input
      bind:this={inputEl}
      type="text"
      placeholder="Search scenes…"
      bind:value={query}
      class="w-full rounded-md border border-border/50 bg-background py-1 pl-6 pr-2 font-sans text-xs
             text-foreground placeholder:text-muted-foreground/40 transition-colors
             focus:border-primary/60 focus:outline-none"
    />
  </div>

  <div class="flex max-h-56 flex-col overflow-y-auto" role="listbox" aria-label="Scenes">
    {#if scenes.scenes.length === 0}
      <p class="px-2 py-2 font-sans text-xs text-muted-foreground/50">
        No scenes yet — create one below.
      </p>
    {:else if filtered.length === 0}
      <p class="px-2 py-2 font-sans text-xs text-muted-foreground/50">No scenes match.</p>
    {:else}
      {#each filtered as scene (scene.id)}
        {@const RowIcon = scene.thumbnail_icon ? (ICON_MAP[scene.thumbnail_icon] ?? Music2) : Music2}
        {@const rowBg = scene.thumbnail_color ?? ACCENT_BG[scene.id % ACCENT_BG.length]}
        {@const rowFg = ACCENT_FG[scene.id % ACCENT_FG.length]}
        <button
          type="button"
          role="option"
          aria-selected="false"
          onclick={() => onSelect(scene.id)}
          class="group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left
                 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground
                 focus-visible:bg-primary/10 focus-visible:text-foreground focus-visible:outline-none"
        >
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-sm"
            style="background-color: {rowBg}"
            aria-hidden="true"
          >
            <RowIcon class="size-3.5" style="color: {rowFg}" strokeWidth={1.75} />
          </span>
          <span class="truncate font-heading text-sm">{scene.name}</span>
        </button>
      {/each}
    {/if}
  </div>

  <!-- ＋ New scene: create an empty Scene and link it immediately; the GM clicks
       through to author its slots later. -->
  <div class="mt-1.5 border-t border-border/50 pt-1.5">
    <button
      type="button"
      onclick={onNewScene}
      class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-muted-foreground
             transition-colors hover:bg-primary/10 hover:text-foreground
             focus-visible:bg-primary/10 focus-visible:text-foreground focus-visible:outline-none"
    >
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded-sm border border-dashed border-border"
        aria-hidden="true"
      >
        <Plus class="size-3.5" />
      </span>
      <span class="font-heading text-sm">New scene</span>
    </button>
  </div>
</div>
