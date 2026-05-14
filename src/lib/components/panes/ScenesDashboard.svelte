<script lang="ts">
  import { Clapperboard, Play, Plus, Star, ExternalLink, Palette, Pencil, Trash2 } from "@lucide/svelte";
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Rename from "$lib/components/ui/rename";
  import type { SceneWithCount } from "$lib/types/vault";
  import { COLOR_PRESETS, ACCENT_BG, ACCENT_FG, ICON_OPTIONS, ICON_MAP } from "./thumbnail-presets";
  import { changeThumbnail, removeThumbnail } from "$lib/utils/thumbnail-actions";

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
      const scene = await scenes.createScene("New Scene");
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
      await scenes.updateScene(sceneId, trimmed);
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
      await scenes.deleteScene(id);
    } catch (e) {
      console.error("delete scene failed:", e);
    }
  }

  async function toggleFavorite(scene: SceneWithCount) {
    try {
      await scenes.toggleFavorite(scene.id);
    } catch (e) {
      console.error("toggle favorite failed:", e);
    }
  }

  let colorPickerScene = $state<SceneWithCount | null>(null);
  let iconPickerScene = $state<SceneWithCount | null>(null);

  async function applyColor(scene: SceneWithCount | null, color: string | null) {
    if (!scene) return;
    try {
      await scenes.applyThumbnailColor(scene.id, color);
    } catch (e) {
      console.error("update thumbnail color failed:", e);
    } finally {
      colorPickerScene = null;
    }
  }

  async function applyIcon(scene: SceneWithCount | null, icon: string | null) {
    if (!scene) return;
    try {
      await scenes.applyThumbnailIcon(scene.id, icon);
    } catch (e) {
      console.error("update thumbnail icon failed:", e);
    } finally {
      iconPickerScene = null;
    }
  }

  let thumbnailUrls = $state<Record<number, string>>({});

  $effect(() => {
    const scenesWithImages = sortedScenes.filter((s) => s.thumbnail_path);
    const activeIds = new Set(scenesWithImages.map((s) => s.id));
    for (const key of Object.keys(thumbnailUrls)) {
      if (!activeIds.has(Number(key))) delete thumbnailUrls[Number(key)];
    }
    for (const scene of scenesWithImages) {
      invoke<string>("get_audio_absolute_path", { relativePath: scene.thumbnail_path! })
        .then((abs) => { if (abs) thumbnailUrls[scene.id] = convertFileSrc(abs); })
        .catch(() => { delete thumbnailUrls[scene.id]; });
    }
  });


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
          {@const ThumbnailIcon = (scene.thumbnail_icon && ICON_MAP[scene.thumbnail_icon]) ?? Clapperboard}
          {@const cardImgUrl = thumbnailUrls[scene.id]}
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
                  style={cardImgUrl ? `background-image: url(${cardImgUrl}); background-size: cover; background-position: center;` : `background: ${cardBg(scene)}`}
                  data-has-thumbnail={scene.thumbnail_path ? true : undefined}
                >
                  {#if cardImgUrl}
                    <div class="pointer-events-none absolute inset-0 bg-black/30"></div>
                  {/if}
                  <span data-thumbnail-icon={scene.thumbnail_icon ?? "Clapperboard"}>
                    <ThumbnailIcon
                      class="size-10 opacity-80"
                      strokeWidth={1.5}
                      style={cardImgUrl ? "color: white; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6))" : `color: ${cardFg(scene)}`}
                    />
                  </span>

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
                  <ContextMenu.Item onclick={() => changeThumbnail(scene.id)}>Change thumbnail</ContextMenu.Item>
                  {#if scene.thumbnail_path}
                    <ContextMenu.Item onclick={() => removeThumbnail(scene.id)}>Remove image</ContextMenu.Item>
                  {/if}
                  <ContextMenu.Item onclick={() => { colorPickerScene = scene; }}>Change color</ContextMenu.Item>
                  <ContextMenu.Item onclick={() => { iconPickerScene = scene; }}>Change icon</ContextMenu.Item>
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

<Dialog.Root
  open={colorPickerScene !== null}
  onOpenChange={(o) => { if (!o) colorPickerScene = null; }}
>
  <Dialog.Content style="max-width: 18rem">
    <Dialog.Header>
      <Dialog.Title>Choose color</Dialog.Title>
    </Dialog.Header>
    <div data-color-picker class="flex flex-col gap-3">
      <div class="grid grid-cols-5 gap-2">
        {#each COLOR_PRESETS as preset (preset.name)}
          <button
            data-color-swatch={preset.name}
            aria-label={preset.label}
            class="size-9 rounded-lg border-2 border-transparent transition-all hover:scale-110 hover:border-foreground/30"
            style="background: {preset.swatch}"
            onclick={() => applyColor(colorPickerScene, preset.bg)}
          ></button>
        {/each}
      </div>
      <Button variant="ghost" size="sm" class="self-start text-muted-foreground" onclick={() => applyColor(colorPickerScene, null)}>
        Reset to default
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root
  open={iconPickerScene !== null}
  onOpenChange={(o) => { if (!o) iconPickerScene = null; }}
>
  <Dialog.Content style="max-width: 22rem">
    <Dialog.Header>
      <Dialog.Title>Choose icon</Dialog.Title>
    </Dialog.Header>
    <div data-icon-picker class="flex flex-col gap-3">
      <div class="grid grid-cols-5 gap-2">
        {#each ICON_OPTIONS as { name, icon: Icon } (name)}
          <button
            data-icon-btn={name}
            aria-label={name}
            class="flex size-10 items-center justify-center rounded-lg border border-transparent bg-muted/50 transition-all hover:border-primary/30 hover:bg-muted"
            onclick={() => applyIcon(iconPickerScene, name)}
          >
            <Icon class="size-5 text-foreground/70" />
          </button>
        {/each}
      </div>
      <Button variant="ghost" size="sm" class="self-start text-muted-foreground" onclick={() => applyIcon(iconPickerScene, null)}>
        Reset to default
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

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
