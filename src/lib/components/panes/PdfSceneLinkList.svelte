<!-- src/lib/components/panes/PdfSceneLinkList.svelte
     "Scenes in this PDF": every Scene-link in the document, in page order, as one list
     to jump from and play from. At the table a GM should not have to hunt for an
     underline on page 14 to start the right sound — the passage is one row away, and
     its Play is right there with it. Lives in a toolbar popover. -->
<script lang="ts">
  import { Play, Square } from "@lucide/svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { sceneIcon, sceneLinkHue } from "./thumbnail-presets";
  import { wash } from "$lib/color";
  import NowPlayingBars from "$lib/components/NowPlayingBars.svelte";
  import type { PdfSceneLink } from "$lib/bindings.gen";
  import type { SceneWithCount } from "$lib/types/ledger";

  let {
    links,
    scenesById,
    onJump,
  }: {
    links: PdfSceneLink[];
    scenesById: Map<number, SceneWithCount>;
    onJump: (link: PdfSceneLink) => void;
  } = $props();

  const ordered = $derived(
    [...links].sort((a, b) => a.page - b.page || a.start_offset - b.start_offset),
  );

  function toggle(scene: SceneWithCount) {
    const state = audioEngine.sceneState(scene.id);
    if (state === "playing") audioEngine.stopAll();
    else if (state === "paused") void audioEngine.resumeScene();
    else if (scene.slot_count > 0) void audioEngine.playScene(scene.id);
  }
</script>

<div class="flex w-80 flex-col">
  <h3 class="px-1 pb-2 text-xs font-semibold text-muted-foreground">Scenes in this PDF</h3>
  {#if ordered.length === 0}
    <p class="px-1 pb-1 text-sm text-muted-foreground">
      No scenes linked yet. Select a passage on a page, then choose Link Scene.
    </p>
  {:else}
    <ul class="-mx-1 flex max-h-80 flex-col overflow-y-auto">
      {#each ordered as link (link.id)}
        {@const scene = scenesById.get(link.scene_id)}
        {#if scene}
          {@const hue = sceneLinkHue(scene)}
          {@const Icon = sceneIcon(scene)}
          {@const playing = audioEngine.sceneState(scene.id) === "playing"}
          <li class="flex items-center gap-1 rounded-md transition-colors hover:bg-muted">
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left
                     focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              onclick={() => onJump(link)}
              title="Go to page {link.page}"
            >
              <span
                class="flex size-6 shrink-0 items-center justify-center rounded-sm"
                style="background: {wash(hue, playing ? 0.3 : 0.18)}"
                aria-hidden="true"
              >
                {#if playing}
                  <NowPlayingBars class="h-2.5" />
                {:else}
                  <Icon class="size-3.5" style="color: {hue}" strokeWidth={1.75} />
                {/if}
              </span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm font-medium text-foreground">{scene.name}</span>
                <span class="truncate text-xs text-muted-foreground">“{link.quote}”</span>
              </span>
              <span class="shrink-0 text-xs tabular-nums text-muted-foreground">p. {link.page}</span>
            </button>
            <button
              type="button"
              class="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-background
                     disabled:cursor-not-allowed disabled:opacity-40
                     focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              disabled={scene.slot_count === 0 && !playing}
              title={scene.slot_count === 0 && !playing ? "No tracks yet" : undefined}
              aria-label={playing ? `Stop ${scene.name}` : `Play ${scene.name}`}
              onclick={() => toggle(scene)}
            >
              {#if playing}
                <Square class="size-3.5 text-foreground" />
              {:else}
                <Play class="size-4 text-foreground" />
              {/if}
            </button>
          </li>
        {/if}
      {/each}
    </ul>
  {/if}
</div>
