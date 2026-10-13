<script lang="ts">
  import {
    Pause,
    Play,
    SlidersHorizontal,
    Plus,
    Star,
    ExternalLink,
    Palette,
    Pencil,
    Trash2,
  } from "@lucide/svelte";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { api } from "$lib/api";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { audioEngine } from "$lib/stores/audio-engine.svelte";
  import { tabs } from "$lib/stores/tabs.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import * as Dialog from "$lib/components/ui/dialog";
  import * as Rename from "$lib/components/ui/rename";
  import type { SceneWithCount } from "$lib/types/ledger";
  import {
    ICON_OPTIONS,
    DEFAULT_SCENE_ICON as DefaultSceneIcon,
    sceneIcon,
    sceneThumbColors,
  } from "./thumbnail-presets";
  import ColorPicker from "$lib/components/ColorPicker.svelte";
  import { storedColorHex } from "$lib/color";
  import { changeThumbnail, removeThumbnail } from "$lib/utils/thumbnail-actions";

  const cardBg = (scene: SceneWithCount) => sceneThumbColors(scene).bg;
  const cardFg = (scene: SceneWithCount) => sceneThumbColors(scene).fg;

  // THE CARD PLAYS. At the table the dashboard is where a GM goes to change the room's
  // sound, so the card's main target — its whole picture — starts the scene, pauses it
  // if it is the one playing, and resumes it if paused. Editing the scene is the
  // deliberate act, and takes its own labelled button in the card's footer (and Open in
  // the context menu). The play control on the picture is always visible: it used to
  // appear only on hover, which hid the one action a GM came here for and left keyboard
  // focus landing on an invisible button.
  function togglePlay(scene: SceneWithCount) {
    if (scene.id === audioEngine.activeSceneId) {
      if (audioEngine.isScenePaused) void audioEngine.resumeScene();
      else void audioEngine.pauseScene();
    } else {
      void audioEngine.playScene(scene.id);
    }
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
    }
    // The dialog stays open: a picker is something to try colours in, and the card
    // behind it shows each one as it lands. Escape or the close button ends it.
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
      api
        .getAudioAbsolutePath(scene.thumbnail_path!)
        .then((abs) => {
          if (abs) thumbnailUrls[scene.id] = convertFileSrc(abs);
        })
        .catch(() => {
          delete thumbnailUrls[scene.id];
        });
    }
  });
</script>

<div data-scenes-dashboard class="flex flex-1 flex-col overflow-y-auto">
  <div class="mx-auto w-full max-w-5xl px-8 pt-8 pb-20">
    <div class="flex items-center justify-between">
      <h1 class="font-sans text-3xl font-semibold tracking-tight text-foreground">All Scenes</h1>
      <Button size="sm" onclick={createScene}>
        <Plus class="size-3.5" />
        New Scene
      </Button>
    </div>
    <div class="mt-3 h-px bg-border"></div>

    {#if scenes.scenes.length === 0}
      <div
        data-empty-state
        class="mt-16 flex flex-col items-center justify-center py-20 text-center"
      >
        <div class="flex size-20 items-center justify-center rounded-lg bg-primary-subtle">
          <DefaultSceneIcon class="size-10 text-primary" strokeWidth={1.5} />
        </div>
        <p class="mt-6 font-heading text-xl text-foreground">Set the mood</p>
        <p class="mt-2 max-w-sm text-sm text-muted-foreground">
          Create your first scene to get started. Layer ambient sounds, music, and effects into a
          soundscape.
        </p>
        <Button class="mt-6" onclick={createScene}>
          <Plus class="size-3.5" />
          New Scene
        </Button>
      </div>
    {:else}
      <div data-scenes-grid class="mt-8 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        {#each sortedScenes as scene (scene.id)}
          {@const isPlaying = scene.id === activeSceneDisplayId}
          {@const showPause = isPlaying && !audioEngine.isScenePaused}
          {@const ThumbnailIcon = sceneIcon(scene)}
          {@const cardImgUrl = thumbnailUrls[scene.id]}
          <ContextMenu.Root>
            <ContextMenu.Trigger>
              <div
                data-scene-card
                data-playing={isPlaying || undefined}
                class="group flex flex-col overflow-hidden rounded-lg border bg-card/40 transition-colors {isPlaying
                  ? 'border-primary/60'
                  : 'border-border hover:border-foreground/20'}"
              >
                <button
                  type="button"
                  data-play-btn
                  aria-label="{showPause ? 'Pause' : 'Play'} {scene.name}"
                  aria-pressed={isPlaying}
                  class="relative flex aspect-[4/3] cursor-pointer items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  style={cardImgUrl
                    ? `background-image: url(${cardImgUrl}); background-size: cover; background-position: center;`
                    : `background: ${cardBg(scene)}`}
                  data-has-thumbnail={scene.thumbnail_path ? true : undefined}
                  onclick={() => togglePlay(scene)}
                >
                  {#if cardImgUrl}
                    <div class="pointer-events-none absolute inset-0 bg-black/30"></div>
                  {/if}
                  <span data-thumbnail-icon={scene.thumbnail_icon ?? "Music2"}>
                    <ThumbnailIcon
                      class="size-10 opacity-80"
                      strokeWidth={1.5}
                      style={cardImgUrl
                        ? "color: white; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6))"
                        : `color: ${cardFg(scene)}`}
                    />
                  </span>

                  {#if scene.favorited}
                    <div class="absolute top-2 left-2" aria-label="Favourite">
                      <Star class="size-3.5 fill-foreground-muted text-foreground-muted" />
                    </div>
                  {/if}

                  <span
                    class="absolute right-2 bottom-2 flex size-9 items-center justify-center rounded-full shadow-float transition-colors {isPlaying
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-black/65 text-white group-hover:bg-primary group-hover:text-primary-foreground'}"
                    aria-hidden="true"
                  >
                    {#if showPause}
                      <Pause class="size-4 fill-current" />
                    {:else}
                      <Play class="size-4 fill-current" />
                    {/if}
                  </span>
                </button>

                <div class="flex items-start gap-2 px-3 py-2.5">
                  <div class="min-w-0 flex-1">
                  <Rename.Root
                    this="p"
                    class="truncate font-heading text-sm text-foreground"
                    inputClass="bg-transparent px-0 py-0 font-heading text-sm"
                    bind:value={
                      () => (renamingSceneId === scene.id ? renameSceneValue : scene.name),
                      (val) => {
                        renameSceneValue = val;
                      }
                    }
                    bind:mode={
                      () => (renamingSceneId === scene.id ? "edit" : "view"),
                      (val) => {
                        if (val === "view") renamingSceneId = null;
                      }
                    }
                    onSave={(val) => handleSceneRename(scene.id, val)}
                    onCancel={() => {
                      renamingSceneId = null;
                    }}
                  />
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {scene.slot_count}
                    {scene.slot_count === 1 ? "track" : "tracks"}
                  </p>
                  </div>
                  <button
                    type="button"
                    data-edit-btn
                    aria-label="Edit {scene.name}"
                    title="Edit scene"
                    class="-mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-hover-overlay hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onclick={() => openScene(scene)}
                  >
                    <SlidersHorizontal class="size-4" />
                  </button>
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
                  <ContextMenu.Item onclick={() => changeThumbnail(scene.id)}
                    >Change thumbnail</ContextMenu.Item
                  >
                  {#if scene.thumbnail_path}
                    <ContextMenu.Item onclick={() => removeThumbnail(scene.id)}
                      >Remove image</ContextMenu.Item
                    >
                  {/if}
                  <ContextMenu.Item
                    onclick={() => {
                      colorPickerScene = scene;
                    }}>Change color</ContextMenu.Item
                  >
                  <ContextMenu.Item
                    onclick={() => {
                      iconPickerScene = scene;
                    }}>Change icon</ContextMenu.Item
                  >
                </ContextMenu.SubContent>
              </ContextMenu.Sub>
              <ContextMenu.Item onclick={() => startSceneRename(scene)}>
                <Pencil class="size-4" />
                Rename
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item variant="destructive" onclick={() => (deleteSceneTarget = scene)}>
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
  onOpenChange={(o) => {
    if (!o) colorPickerScene = null;
  }}
>
  <Dialog.Content style="max-width: 18rem">
    <Dialog.Header>
      <Dialog.Title>Color</Dialog.Title>
    </Dialog.Header>
    {#if colorPickerScene}
      <ColorPicker
        value={storedColorHex(
          scenes.scenes.find((s) => s.id === colorPickerScene?.id)?.thumbnail_color ?? null,
        )}
        onchange={(hex) => applyColor(colorPickerScene, hex)}
      />
    {/if}
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root
  open={iconPickerScene !== null}
  onOpenChange={(o) => {
    if (!o) iconPickerScene = null;
  }}
>
  <Dialog.Content style="max-width: 22rem">
    <Dialog.Header>
      <Dialog.Title>Choose icon</Dialog.Title>
    </Dialog.Header>
    <div data-icon-picker class="flex flex-col gap-3">
      <div class="grid grid-cols-5 gap-2">
        {#each ICON_OPTIONS as { name, label, icon: Icon } (name)}
          <button
            data-icon-btn={name}
            aria-label={label}
            class="flex size-10 items-center justify-center rounded-lg border border-transparent bg-muted/50 transition-colors hover:border-primary/30 hover:bg-muted"
            onclick={() => applyIcon(iconPickerScene, name)}
          >
            <Icon class="size-5 text-foreground/70" />
          </button>
        {/each}
      </div>
      <Button
        variant="ghost"
        size="sm"
        class="self-start text-muted-foreground"
        onclick={() => applyIcon(iconPickerScene, null)}
      >
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
        <span class="font-medium text-foreground">{deleteSceneTarget?.name}</span>? This action
        cannot be undone.
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
