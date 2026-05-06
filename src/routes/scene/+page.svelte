<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { goto } from "$app/navigation";
  import { scenes } from "$lib/stores/scenes.svelte";
  import { breadcrumbs } from "$lib/stores/breadcrumbs.svelte";
  import { Button } from "$lib/components/ui/button";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import * as ContextMenu from "$lib/components/ui/context-menu";
  import { Music2, Plus, Star, Trash2, Pencil } from "@lucide/svelte";
  import * as Rename from "$lib/components/ui/rename";
  import type { Scene, SceneWithCount } from "$lib/types/vault";
  import { toastUndo } from "$lib/toast";

  let isCreating = $state(false);
  let renamingId = $state<number | null>(null);
  let renameValue = $state("");

  $effect(() => {
    breadcrumbs.set([{ label: "Scenes" }]);
    return () => breadcrumbs.clear();
  });

  async function createScene() {
    if (isCreating) return;
    isCreating = true;
    try {
      const scene = await invoke<Scene>("create_scene", { name: "Untitled Scene" });
      await scenes.load();
      await goto(`/scene/${scene.id}`);
    } catch (e) {
      console.error("Failed to create scene:", e);
    } finally {
      isCreating = false;
    }
  }

  async function toggleFavorite(scene: SceneWithCount) {
    try {
      await invoke("toggle_scene_favorite", { id: scene.id });
      await scenes.load();
    } catch (e) {
      console.error("Failed to toggle favorite:", e);
    }
  }

  function deleteScene(scene: SceneWithCount) {
    toastUndo(`"${scene.name}" deleted`, async () => {
      try {
        await invoke("delete_scene", { id: scene.id });
        await scenes.load();
      } catch (e) {
        console.error("Failed to delete scene:", e);
      }
    });
  }

  function startRename(scene: SceneWithCount) {
    renameValue = scene.name;
    renamingId = scene.id;
  }

  async function handleRename(id: number, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) {
      renamingId = null;
      return;
    }
    try {
      await invoke("update_scene", { id, name: trimmed });
      await scenes.load();
    } catch (e) {
      console.error("Failed to rename scene:", e);
    } finally {
      renamingId = null;
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
</script>

<div class="flex flex-1 flex-col overflow-y-auto">
  <div class="mx-auto w-full max-w-5xl px-8 pt-8 pb-20">
    <!-- Header -->
    <div class="flex items-start justify-between">
      <div>
        <h1 class="font-heading text-3xl text-foreground">Scenes</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Ambient soundscapes for your sessions
        </p>
      </div>
      <Button variant="outline" size="sm" onclick={createScene} disabled={isCreating}>
        <Plus class="size-3.5" />
        New Scene
      </Button>
    </div>
    <div class="mt-4 h-px bg-gradient-to-r from-primary/30 via-primary/10 to-transparent"></div>

    <!-- Loading -->
    {#if scenes.isLoading}
      <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each { length: 6 } as _, i (i)}
          <Skeleton class="h-28 rounded-lg" />
        {/each}
      </div>

    <!-- Empty state -->
    {:else if scenes.scenes.length === 0}
      <div class="flex flex-1 flex-col items-center justify-center py-24">
        <div class="flex size-16 items-center justify-center rounded-xl bg-primary/10">
          <Music2 class="size-7 text-primary" />
        </div>
        <h2 class="mt-5 font-heading text-xl text-foreground">No scenes yet</h2>
        <p class="mt-2 max-w-sm text-center text-sm text-muted-foreground">
          Scenes are ambient soundscapes for your sessions. Layer audio tracks to
          set the mood for taverns, dungeons, or epic battles.
        </p>
        <Button variant="outline" size="sm" class="mt-6" onclick={createScene} disabled={isCreating}>
          <Plus class="size-3.5" />
          Create your first scene
        </Button>
      </div>

    <!-- Scene grid -->
    {:else}
      <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {#each scenes.scenes as scene (scene.id)}
          <ContextMenu.Root>
            <ContextMenu.Trigger>
              <a
                href="/scene/{scene.id}"
                class="block"
                onclick={(e) => { if (renamingId === scene.id) e.preventDefault(); }}
              >
                <div
                  class="group relative rounded-lg border border-border/60 bg-card p-5
                         transition-colors hover:border-primary/25"
                >
                  <!-- Favorite toggle -->
                  <button
                    type="button"
                    class="absolute top-4 right-4 p-1 transition-colors"
                    onclick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      toggleFavorite(scene);
                    }}
                  >
                    <Star
                      class="size-4 {scene.favorited
                        ? 'fill-primary/60 text-primary'
                        : 'text-muted-foreground/40 hover:text-primary/60'} transition-colors"
                    />
                  </button>

                  <!-- Scene name (inline-renameable) -->
                  <Rename.Root
                    this="h3"
                    class="truncate pr-8 font-heading text-lg leading-snug text-foreground"
                    inputClass="bg-transparent px-0 py-0 font-heading text-lg leading-snug"
                    bind:value={
                      () => renamingId === scene.id ? renameValue : scene.name,
                      (val) => { renameValue = val; }
                    }
                    bind:mode={
                      () => (renamingId === scene.id ? "edit" : "view"),
                      (val) => { if (val === "view") renamingId = null; }
                    }
                    onSave={(val) => handleRename(scene.id, val)}
                    onCancel={() => { renamingId = null; }}
                  />

                  <!-- Gradient line -->
                  <div class="mt-2 h-px bg-gradient-to-r from-primary/20 to-transparent"></div>

                  <!-- Metadata -->
                  <div class="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <Music2 class="size-3" />
                    <span>{scene.slot_count} {scene.slot_count === 1 ? "track" : "tracks"}</span>
                    <span class="text-muted-foreground/40">&middot;</span>
                    <span>{formatDate(scene.created_at)}</span>
                  </div>
                </div>
              </a>
            </ContextMenu.Trigger>
            <ContextMenu.Content>
              <ContextMenu.Item onclick={() => startRename(scene)}>
                <Pencil class="size-4" />
                Rename
              </ContextMenu.Item>
              <ContextMenu.Item
                onclick={() => toggleFavorite(scene)}
              >
                <Star class="size-4" />
                {scene.favorited ? "Remove Favorite" : "Favorite"}
              </ContextMenu.Item>
              <ContextMenu.Separator />
              <ContextMenu.Item
                variant="destructive"
                onclick={() => deleteScene(scene)}
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

