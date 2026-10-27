<!--
  The Scenes group in the expanded sidebar — the place a GM changes the room's sound
  mid-session in one click.

  Each listed scene is a row that opens it, with its own play/pause button beside it,
  always visible: switching scenes at the table is the act this group exists for, and a
  control that waits for hover is a control the GM has to hunt for. The list is the
  favourites; with none favourited yet it is the three newest scenes, so a fresh ledger
  still has something to press. "All scenes" closes the list, as the way to the rest.

  Hidden wholesale when collapsed, as Files is — the strip's Scenes stand-in expands the
  sidebar and scrolls to the `id` below, so this is the surface it hands over (#226).
  Graph is deliberately NOT here: it is not a scene (#235).
-->
<script lang="ts">
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { LayoutList, Music2, Pause, Play, Volume2 } from "@lucide/svelte";
  import Disclosure from "$lib/components/Disclosure.svelte";
  import DisclosureChevron from "$lib/components/DisclosureChevron.svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { shell } from "$lib/utils/shell-actions";
  import { EXPANDED_ONLY } from "./strip-classes";
  import { cn } from "$lib/utils";
  import type { SceneWithCount } from "$lib/types/ledger";

  const RECENT_FALLBACK = 3;

  let groupOpen = $state(true);

  // Both read straight off the global stores, so this component takes no props.
  const favoriteScenes = $derived(scenes.scenes.filter((s) => s.favorited));
  const listedScenes = $derived(
    favoriteScenes.length > 0
      ? favoriteScenes
      : [...scenes.scenes]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, RECENT_FALLBACK),
  );

  // The dashboard card's toggle: press the playing scene to pause it, a paused one to
  // resume, any other to switch to it.
  function togglePlay(scene: SceneWithCount) {
    if (scene.id === audioEngine.activeSceneId) {
      if (audioEngine.isScenePaused) void audioEngine.resumeScene();
      else void audioEngine.pauseScene();
    } else {
      void audioEngine.playScene(scene.id);
    }
  }
</script>

<div id="sidebar-scenes-section" class={EXPANDED_ONLY}>
  <Collapsible.Root bind:open={groupOpen} class="group/collapsible">
    <Sidebar.Group>
      <Sidebar.GroupLabel>
        {#snippet child({ props })}
          <Collapsible.Trigger {...props}>
            Scenes
            <DisclosureChevron open={groupOpen} class="ms-auto" />
          </Collapsible.Trigger>
        {/snippet}
      </Sidebar.GroupLabel>
      <Collapsible.Content forceMount>
        {#snippet child({ props, open })}
          <div {...props}>
            <Disclosure {open}>
              <Sidebar.GroupContent>
                <Sidebar.Menu>
                  {#each listedScenes as scene (scene.id)}
                    <!-- Crimson while it sounds, and while it is starting, so the mark does
                         not wait for the audio. A paused scene keeps its speaker, quiet: it is
                         still the one the mini player holds, but nothing is playing. -->
                    {@const sceneState = audioEngine.sceneState(scene.id)}
                    {@const isPlaying = sceneState === "playing" || sceneState === "loading"}
                    {@const showPause = isPlaying}
                    <Sidebar.MenuItem>
                      <!-- No `isActive`: that background means "the page you are on", and
                           a playing scene is not where the GM is. Playing is said by
                           the crimson speaker and the crimson pause — signals of
                           their own, on the row's two ends. -->
                      <Sidebar.MenuButton>
                        {#snippet child({ props })}
                          <button
                            type="button"
                            {...props}
                            data-scene-playing={isPlaying || undefined}
                            onclick={() =>
                              tabs.navigateOpen({
                                type: "scene",
                                id: scene.id,
                                title: scene.name,
                              })}
                          >
                            {#if isPlaying}
                              <Volume2 class="size-4 text-primary" />
                            {:else if sceneState === "paused"}
                              <Volume2 class="size-4 text-muted-foreground" />
                            {:else}
                              <Music2 class="size-4 text-muted-foreground" />
                            {/if}
                            <span class="truncate pe-6">{scene.name}</span>
                          </button>
                        {/snippet}
                      </Sidebar.MenuButton>
                      <Sidebar.MenuAction
                        data-testid="sidebar-scene-play"
                        aria-label="{showPause ? 'Pause' : 'Play'} {scene.name}"
                        aria-pressed={isPlaying}
                        class={cn(
                          // A filled glyph reads a size heavier than the outlined icons
                          // around it, so it drops to 12px to sit at their weight.
                          "[&>svg]:size-3",
                          isPlaying
                            ? "text-primary hover:text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                        onclick={() => togglePlay(scene)}
                      >
                        {#if showPause}
                          <Pause class="fill-current" />
                        {:else}
                          <Play class="fill-current" />
                        {/if}
                      </Sidebar.MenuAction>
                    </Sidebar.MenuItem>
                  {/each}
                  <Sidebar.MenuItem>
                    <Sidebar.MenuButton>
                      {#snippet child({ props })}
                        <button
                          type="button"
                          {...props}
                          data-testid="sidebar-scenes"
                          onclick={shell.openScenes}
                        >
                          <LayoutList class="size-4" />
                          All Scenes
                        </button>
                      {/snippet}
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                </Sidebar.Menu>
              </Sidebar.GroupContent>
            </Disclosure>
          </div>
        {/snippet}
      </Collapsible.Content>
    </Sidebar.Group>
  </Collapsible.Root>
</div>
