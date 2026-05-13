<script lang="ts">
  import { Clapperboard, Play, Plus, Star, ExternalLink, Palette, Pencil, Trash2 } from "@lucide/svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import * as Rename from "$lib/components/ui/rename";
  import type { SceneWithCount } from "$lib/types/vault";

  // Fallback accent colors keyed by scene.id % 5: crimson, arcane, verdant, ice, amber
  const ACCENT_BG = [
    "rgba(194,72,61,0.18)",
    "rgba(155,107,191,0.18)",
    "rgba(92,158,110,0.18)",
    "rgba(91,158,201,0.18)",
    "rgba(196,154,60,0.18)",
  ];
  const ACCENT_FG = ["#c2483d", "#9b6bbf", "#5c9e6e", "#5b9ec9", "#c49a3c"];

  function cardBg(scene: SceneWithCount): string {
    return scene.thumbnail_color ?? ACCENT_BG[scene.id % 5];
  }

  function cardFg(scene: SceneWithCount): string {
    return ACCENT_FG[scene.id % 5];
  }

  let sortedScenes = $derived(
    [...scenes.scenes].sort((a, b) => {
      if (a.favorited !== b.favorited) return b.favorited - a.favorited;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }),
  );

  let activeSceneDisplayId = $derived(audioEngine.loadingSceneId ?? audioEngine.activeSceneId);

  async function createScene() {
    try {
      const scene = await invoke<SceneWithCount>("create_scene", {
        name: "New Scene",
      });
      await scenes.load();
      tabs.openTab({ type: "scene", id: scene.id, title: scene.name });
    } catch (e) {
      console.error("create scene failed:", e);
    }
  }

  function openScene(scene: SceneWithCount) {
    tabs.openTab({ type: "scene", id: scene.id, title: scene.name });
  }

  let renamingSceneId = $state<number | null>(null);
  let renameSceneValue = $state("");

  function startSceneRename(scene: SceneWithCount) {
    renameSceneValue = scene.name;
    renamingSceneId = scene.id;
  }

  async function handleSceneRename(sceneId: number, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) {
      renamingSceneId = null;
      return;
    }
    const scene = scenes.scenes.find((s) => s.id === sceneId);
    if (!scene || trimmed === scene.name) {
      renamingSceneId = null;
      return;
    }
    try {
      await invoke("update_scene", { id: sceneId, name: trimmed });
      await scenes.load();
    } catch (e) {
      console.error("rename scene failed:", e);
    } finally {
      renamingSceneId = null;
    }
  }

  let deleteSceneTarget = $state<SceneWithCount | null>(null);

  async function confirmDeleteScene() {
    if (!deleteSceneTarget) return;
    const id = deleteSceneTarget.id;
    deleteSceneTarget = null;
    try {
      await invoke("delete_scene", { id });
      await scenes.load();
    } catch (e) {
      console.error("delete scene failed:", e);
    }
  }

  async function toggleFavorite(scene: SceneWithCount) {
    try {
      await invoke("toggle_scene_favorite", { id: scene.id });
      await scenes.load();
    } catch (e) {
      console.error("toggle favorite failed:", e);
    }
  }
</script>

<div data-scenes-dashboard class="flex flex-1 flex-col overflow-y-auto">
  <div class="mx-auto w-full max-w-5xl px-8 pt-8 pb-20">
    <div class="flex items-center justify-between">
      <h1 class="font-heading text-3xl tracking-tight text-foreground">
        All Scenes
      </h1>
      <Button size="sm" onclick={createScene}>
        <Plus class="size-3.5" />
        New Scene
      </Button>
    </div>
    <div
      class="mt-3 h-px bg-linear-to-r from-primary/30 via-primary/10 to-transparent"
    ></div>

    {#if scenes.scenes.length === 0}
      <div
        data-empty-state
        class="mt-16 flex flex-col items-center justify-center py-20 text-center"
      >
        <div
          class="flex size-20 items-center justify-center rounded-2xl"
          style="background: {ACCENT_BG[0]}"
        >
          <Clapperboard
            class="size-10"
            style="color: {ACCENT_FG[0]}"
            strokeWidth={1.5}
          />
        </div>
        <p class="mt-6 font-heading text-xl text-foreground">
          Set the mood
        </p>
        <p class="mt-2 max-w-sm text-sm text-muted-foreground">
          Create your first scene to get started. Layer ambient sounds, music,
          and effects into a soundscape.
        </p>
        <Button class="mt-6" onclick={createScene}>
          <Plus class="size-3.5" />
          New Scene
        </Button>
      </div>
    {:else}
      <div
        data-scenes-grid
        class="mt-8 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4"
      >
        {#each sortedScenes as scene (scene.id)}
          {@const isPlaying = scene.id === activeSceneDisplayId}
          <ContextMenu.Root>
            <ContextMenu.Trigger>
              <div
                data-scene-card
                data-playing={isPlaying || undefined}
                role="button"
                tabindex="0"
                class="group flex cursor-pointer flex-col overflow-hidden rounded-lg bg-card/60 transition-shadow hover:shadow-lg {isPlaying ? 'ring-2 ring-primary' : ''}"
                onclick={() => openScene(scene)}
                onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") openScene(scene); }}
              >
                <div
                  class="relative flex aspect-[4/3] items-center justify-center"
                  style="background: {cardBg(scene)}"
                >
                  <Clapperboard
                    class="size-10 opacity-80"
                    style="color: {cardFg(scene)}"
                    strokeWidth={1.5}
                  />

                  {#if scene.favorited}
                    <div class="absolute top-2 left-2">
                      <Star class="size-3.5 fill-amber-400 text-amber-400" />
                    </div>
                  {/if}

                  <button
                    data-play-btn
                    aria-label="Play {scene.name}"
                    class="absolute right-2 bottom-2 flex size-8 items-center justify-center rounded-full bg-black/40 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
                    onclick={(e) => { e.stopPropagation(); audioEngine.playScene(scene.id); }}
                  >
                    <Play class="size-3.5 fill-white text-white" />
                  </button>
                </div>

                <div class="px-3 py-2.5">
                  <Rename.Root
                    this="p"
                    class="truncate font-heading text-sm text-foreground"
                    inputClass="bg-transparent px-0 py-0 font-heading text-sm"
                    bind:value={
                      () => renamingSceneId === scene.id ? renameSceneValue : scene.name,
                      (val) => { renameSceneValue = val; }
                    }
                    bind:mode={
                      () => renamingSceneId === scene.id ? "edit" : "view",
                      (val) => { if (val === "view") renamingSceneId = null; }
                    }
                    onSave={(val) => handleSceneRename(scene.id, val)}
                    onCancel={() => { renamingSceneId = null; }}
                  />
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {scene.slot_count}
                    {scene.slot_count === 1 ? "track" : "tracks"}
                  </p>
                </div>
              </div>
            </ContextMenu.Trigger>

            <ContextMenu.Content>
              <ContextMenu.Item onclick={() => openScene(scene)}>
                <ExternalLink class="size-4" />
                Open
              </ContextMenu.Item>
              <ContextMenu.Item onclick={() => audioEngine.playScene(scene.id)}>
                <Play class="size-4" />
                Play
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item onclick={() => toggleFavorite(scene)}>
                <Star class="size-4" />
                {scene.favorited ? "Unfavorite" : "Favorite"}
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger>
                  <Palette class="size-4" />
                  Customise
                </ContextMenu.SubTrigger>
                <ContextMenu.SubContent>
                  <ContextMenu.Item>Change thumbnail</ContextMenu.Item>
                  <ContextMenu.Item>Change color</ContextMenu.Item>
                  <ContextMenu.Item>Change icon</ContextMenu.Item>
                </ContextMenu.SubContent>
              </ContextMenu.Sub>
              <ContextMenu.Item onclick={() => startSceneRename(scene)}>
                <Pencil class="size-4" />
                Rename
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item
                variant="destructive"
                onclick={() => (deleteSceneTarget = scene)}
              >
                <Trash2 class="size-4" />
                Delete
              </ContextMenu.Item>
            </ContextMenu.Content>
          </ContextMenu.Root>
        {/each}
      </div>
    {/if}
  </div>
</div>

<AlertDialog.Root
  open={deleteSceneTarget !== null}
  onOpenChange={(o) => {
    if (!o) deleteSceneTarget = null;
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete scene</AlertDialog.Title>
      <AlertDialog.Description>
        Are you sure you want to delete
        <span class="font-medium text-foreground">{deleteSceneTarget?.name}</span>?
        This action cannot be undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={confirmDeleteScene}>
        Delete
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
