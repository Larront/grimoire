<!--
  The Scenes group in the expanded sidebar: All Scenes, then the favourites, with
  the playing one marked.

  Hidden wholesale when collapsed, as Files is — the strip's Scenes stand-in
  expands the sidebar and scrolls to the `id` below, so this is the surface it
  hands over (#226). Graph is deliberately NOT here: it opens a tab as these rows
  do, but it is not a scene and sits as a peer of this group rather than a row in
  it (#235, and the comment on that issue).
-->
<script lang="ts">
  import * as Collapsible from "$lib/components/ui/collapsible";
  import * as Sidebar from "$lib/components/ui/sidebar";
  import { ChevronDown, LayoutList, Star, Volume2 } from "@lucide/svelte";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { shell } from "$lib/utils/shell-actions";
  import { slide } from "svelte/transition";
  import { EXPANDED_ONLY } from "./strip-classes";

  // Both read straight off the global stores, so this component takes no props.
  const favoriteScenes = $derived(scenes.scenes.filter((s) => s.favorited));

  // A scene that is loading shows as the active one, so the mark does not wait
  // for audio to actually start.
  const activeSceneDisplayId = $derived(audioEngine.loadingSceneId ?? audioEngine.activeSceneId);
</script>

<div id="sidebar-scenes-section" class={EXPANDED_ONLY}>
  <Collapsible.Root open class="group/collapsible">
    <Sidebar.Group>
      <Sidebar.GroupLabel>
        {#snippet child({ props })}
          <Collapsible.Trigger {...props}>
            Scenes
            <ChevronDown
              class="ms-auto transition-transform group-data-[state=open]/collapsible:rotate-180"
            />
          </Collapsible.Trigger>
        {/snippet}
      </Sidebar.GroupLabel>
      <Collapsible.Content forceMount>
        {#snippet child({ props, open })}
          {#if open}
            <div {...props} transition:slide>
              <Sidebar.GroupContent>
                <Sidebar.Menu>
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
                  {#each favoriteScenes as scene (scene.id)}
                    <Sidebar.MenuItem>
                      <Sidebar.MenuButton>
                        {#snippet child({ props })}
                          {@const isPlaying = scene.id === activeSceneDisplayId}
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
                            {:else}
                              <Star class="size-4 fill-primary/30 text-primary" />
                            {/if}
                            <span class="truncate">{scene.name}</span>
                          </button>
                        {/snippet}
                      </Sidebar.MenuButton>
                    </Sidebar.MenuItem>
                  {/each}
                </Sidebar.Menu>
              </Sidebar.GroupContent>
            </div>
          {/if}
        {/snippet}
      </Collapsible.Content>
    </Sidebar.Group>
  </Collapsible.Root>
</div>
