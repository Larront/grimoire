<script lang="ts">
  import {
    Pause,
    Play,
    SlidersHorizontal,
    Plus,
    Square,
    Star,
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
  import * as Popover from "$lib/components/ui/popover";
  import * as Rename from "$lib/components/ui/rename";
  import SceneAppearance from "$lib/components/SceneAppearance.svelte";
  import { toastUndo } from "$lib/toast";
  import { isTypingIn } from "$lib/utils/keyboard";
  import { SvelteSet } from "svelte/reactivity";
  import type { SceneWithCount } from "$lib/types/ledger";
  import {
    DEFAULT_SCENE_ICON as DefaultSceneIcon,
    sceneIcon,
    sceneThumbColors,
  } from "./thumbnail-presets";

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

  // A scene being deleted leaves the grid at once; it is gone for good only when its
  // Undo toast closes.
  let pendingDeletion = new SvelteSet<number>();

  let sortedScenes = $derived(
    scenes.scenes.filter((s) => !pendingDeletion.has(s.id)).sort((a, b) => {
      if (a.favorited !== b.favorited) return b.favorited - a.favorited;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    }),
  );

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

  // An undo toast, as a track's removal has, rather than the modal "cannot be undone"
  // it was (2026-10 design review; DESIGN.md: a modal is disproportionate here). A
  // scene that is sounding falls quiet while it waits, and comes back with Undo.
  function deleteScene(scene: SceneWithCount) {
    const id = scene.id;
    const wasSounding = audioEngine.activeSceneId === id && !audioEngine.isScenePaused;
    pendingDeletion.add(id);
    if (wasSounding) void audioEngine.pauseScene();
    toastUndo(
      `Deleted “${scene.name}”`,
      async () => {
        try {
          if (audioEngine.activeSceneId === id) audioEngine.stopAll();
          await scenes.deleteScene(id);
        } catch (e) {
          console.error("delete scene failed:", e);
        } finally {
          pendingDeletion.delete(id);
        }
      },
      () => {
        pendingDeletion.delete(id);
        if (wasSounding && audioEngine.activeSceneId === id) void audioEngine.resumeScene();
      },
    );
  }

  async function toggleFavorite(scene: SceneWithCount) {
    try {
      await scenes.toggleFavorite(scene.id);
    } catch (e) {
      console.error("toggle favorite failed:", e);
    }
  }

  // ── The card's menu ─────────────────────────────────────────────────────
  // Playing first: at the table this is where a GM changes the room's sound. Then
  // editing, then Delete. Picture, colour and icon are one Appearance popover at the
  // card — the Scene pane's own — where a "Customise" submenu opened three windows.

  let appearanceScene = $state<SceneWithCount | null>(null);
  let appearanceAnchor = $state<HTMLElement | null>(null);

  function cardOf(id: number): HTMLElement | null {
    return document.querySelector(`[data-scene-card="${id}"]`);
  }

  function openAppearance(scene: SceneWithCount) {
    appearanceAnchor = cardOf(scene.id);
    appearanceScene = scene;
  }

  // Rename and Appearance take focus somewhere of their own; the menu must not pull it
  // back to the card as it closes (a scene's rename used to end with focus on nothing).
  let handingOff = false;
  function keepFocusIfHandedOff(e: Event) {
    if (handingOff) e.preventDefault();
    handingOff = false;
  }

  type Action = {
    label: string;
    icon: typeof Play;
    run: () => void;
    key?: string;
    destructive?: boolean;
  };

  function actionsFor(scene: SceneWithCount, sounding: boolean): Action[][] {
    const active = audioEngine.activeSceneId === scene.id;
    return [
      [
        sounding
          ? { label: "Stop", icon: Square, run: () => audioEngine.stopAll() }
          : {
              label: "Play",
              icon: Play,
              run: () =>
                active && audioEngine.isScenePaused
                  ? void audioEngine.resumeScene()
                  : void audioEngine.playScene(scene.id),
            },
        { label: "Open", icon: SlidersHorizontal, run: () => openScene(scene) },
      ],
      [
        {
          label: "Rename",
          icon: Pencil,
          key: "F2",
          run: () => {
            handingOff = true;
            startSceneRename(scene);
          },
        },
        {
          label: "Appearance…",
          icon: Palette,
          run: () => {
            handingOff = true;
            openAppearance(scene);
          },
        },
        {
          label: scene.favorited ? "Unfavourite" : "Favourite",
          icon: Star,
          run: () => toggleFavorite(scene),
        },
      ],
      [
        {
          label: `Delete “${scene.name}”`,
          icon: Trash2,
          key: "Del",
          destructive: true,
          run: () => deleteScene(scene),
        },
      ],
    ];
  }

  function onCardKeydown(e: KeyboardEvent, scene: SceneWithCount) {
    if (isTypingIn(e.target)) return;
    if (e.key === "F2") {
      e.preventDefault();
      startSceneRename(scene);
    } else if (e.key === "Delete") {
      e.preventDefault();
      deleteScene(scene);
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
    <!-- 28px, the type scale's first heading step (it was 30, off the scale); the
         header's New scene only once there are scenes — when there are none the empty
         state's is the one way on, rather than one of two crimson buttons. -->
    <div class="flex items-center justify-between">
      <h1 class="font-sans text-[1.75rem] leading-tight font-semibold tracking-tight text-foreground">
        All Scenes
      </h1>
      {#if scenes.scenes.length > 0}
        <Button size="sm" onclick={createScene}>
          <Plus class="size-3.5" />
          New scene
        </Button>
      {/if}
    </div>
    <div class="mt-3 h-px bg-border"></div>

    {#if scenes.scenes.length === 0}
      <div
        data-empty-state
        class="mt-8 flex flex-col items-center justify-center py-16 text-center"
      >
        <!-- The scene editor's empty state, the house one: a neutral tile, a heading,
             one line, one way on. This one had a crimson tile, which is none of the
             things the accent means (2026-10 design review). -->
        <div class="flex size-12 items-center justify-center rounded-lg bg-muted">
          <DefaultSceneIcon class="size-6 text-muted-foreground" strokeWidth={1.5} />
        </div>
        <h2 class="mt-5 font-heading text-[1.375rem] leading-tight font-normal text-foreground">
          Set the mood
        </h2>
        <p class="mt-2 max-w-sm text-sm text-muted-foreground">
          A scene layers rain, a crowd and music, and plays them together at the table.
        </p>
        <Button size="sm" class="mt-5" onclick={createScene}>
          <Plus class="size-3.5" />
          New scene
        </Button>
      </div>
    {:else}
      <div data-scenes-grid class="mt-8 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
        {#each sortedScenes as scene (scene.id)}
          <!-- Crimson while it sounds or is starting; a paused scene's card is at rest,
               and its play control resumes it. -->
          {@const sceneState = audioEngine.sceneState(scene.id)}
          {@const isPlaying = sceneState === "playing" || sceneState === "loading"}
          {@const showPause = isPlaying}
          {@const ThumbnailIcon = sceneIcon(scene)}
          {@const cardImgUrl = thumbnailUrls[scene.id]}
          <ContextMenu.Root>
            <ContextMenu.Trigger>
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                data-scene-card={scene.id}
                data-playing={isPlaying || undefined}
                onkeydown={(e) => onCardKeydown(e, scene)}
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
                    fallbackSelectionBehavior="all"
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

            <ContextMenu.Content class="max-w-72" onCloseAutoFocus={keepFocusIfHandedOff}>
              {#each actionsFor(scene, isPlaying) as group, g (g)}
                {#if g > 0}<ContextMenu.Separator />{/if}
                {#each group as action (action.label)}
                  {@const Icon = action.icon}
                  <ContextMenu.Item
                    variant={action.destructive ? "destructive" : "default"}
                    onSelect={action.run}
                  >
                    <Icon />
                    <span class="min-w-0 truncate">{action.label}</span>
                    {#if action.key}<ContextMenu.Shortcut>{action.key}</ContextMenu.Shortcut>{/if}
                  </ContextMenu.Item>
                {/each}
              {/each}
            </ContextMenu.Content>
          </ContextMenu.Root>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- At the card it was opened from, and focus goes back to that card's play control. -->
<Popover.Root
  open={appearanceScene !== null}
  onOpenChange={(o) => {
    if (!o) appearanceScene = null;
  }}
>
  <Popover.Content
    customAnchor={appearanceAnchor}
    side="right"
    align="start"
    class="flex w-72 flex-col gap-4"
    onCloseAutoFocus={(e) => {
      e.preventDefault();
      appearanceAnchor?.querySelector<HTMLElement>("[data-play-btn]")?.focus();
    }}
  >
    {#if appearanceScene}
      {@const live = scenes.scenes.find((x) => x.id === appearanceScene?.id) ?? appearanceScene}
      <SceneAppearance scene={live} />
    {/if}
  </Popover.Content>
</Popover.Root>
