<!--
  @component
  The Scenes stand-in on the collapsed strip, and — while a scene is the active one —
  its pause beneath it. Collapsing the sidebar to focus on a note used to take the mini
  player with it and leave a plain note glyph: nothing said music was playing, and
  nothing on screen could pause it. The stand-in now draws the playing bars while a
  scene sounds, and the one control a GM reaches for mid-session sits under it.

  Each is its own group, spaced as every entry on the strip is. Rendered only collapsed.
-->
<script lang="ts">
  import * as Sidebar from "$lib/components/ui/sidebar";
  import NowPlayingBars from "$lib/components/NowPlayingBars.svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { Music2, Pause, Play } from "@lucide/svelte";
  import { STRIP_ICON } from "./strip-classes";

  let { onReveal }: { onReveal: () => void } = $props();

  const sceneId = $derived(audioEngine.loadingSceneId ?? audioEngine.activeSceneId);
  const sceneName = $derived(scenes.scenes.find((s) => s.id === sceneId)?.name ?? "scene");
  const sceneState = $derived(audioEngine.sceneState(sceneId));
  const isSounding = $derived(sceneState === "playing" || sceneState === "loading");
  const isPaused = $derived(sceneState === "paused");
</script>

<Sidebar.Group class="hidden group-data-[collapsible=icon]:block">
  <Sidebar.GroupContent>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton>
          {#snippet child({ props })}
            <button
              type="button"
              {...props}
              data-testid="sidebar-scenes-standin"
              aria-label={isSounding ? `Scenes — ${sceneName} playing` : "Scenes"}
              title={isSounding ? `Scenes — ${sceneName} playing` : "Scenes"}
              onclick={onReveal}
            >
              {#if isSounding}
                <NowPlayingBars class="h-3.5" />
              {:else}
                <Music2 class={STRIP_ICON} strokeWidth={1.5} />
              {/if}
            </button>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.GroupContent>
</Sidebar.Group>

{#if sceneId !== null}
  <Sidebar.Group class="hidden group-data-[collapsible=icon]:block">
    <Sidebar.GroupContent>
      <Sidebar.Menu>
        <Sidebar.MenuItem>
          <Sidebar.MenuButton>
            {#snippet child({ props })}
              <button
                type="button"
                {...props}
                data-testid="sidebar-scenes-pause"
                aria-disabled={sceneState === "loading"}
                aria-label={isPaused ? `Resume ${sceneName}` : `Pause ${sceneName}`}
                title={isPaused ? `Resume ${sceneName}` : `Pause ${sceneName}`}
                onclick={() => audioEngine.togglePauseScene()}
              >
                {#if isPaused}
                  <Play class={STRIP_ICON} strokeWidth={1.5} />
                {:else}
                  <Pause class={STRIP_ICON} strokeWidth={1.5} />
                {/if}
              </button>
            {/snippet}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      </Sidebar.Menu>
    </Sidebar.GroupContent>
  </Sidebar.Group>
{/if}
