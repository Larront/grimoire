import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { remove } from "@tauri-apps/plugin-fs";
import { scenes } from "$lib/stores/scenes.svelte";

async function deleteOldThumbnailFile(path: string | null): Promise<void> {
  if (!path) return;
  try {
    const abs = await invoke<string>("get_audio_absolute_path", { relativePath: path });
    if (abs) await remove(abs);
  } catch { /* non-critical */ }
}

export async function changeThumbnail(sceneId: number): Promise<void> {
  const picked = await open({
    title: "Choose Thumbnail Image",
    filters: [{ name: "Image", extensions: ["jpg", "jpeg", "png", "webp", "gif"] }],
  });
  if (!picked || typeof picked !== "string") return;
  const oldPath = scenes.scenes.find((s) => s.id === sceneId)?.thumbnail_path ?? null;
  const relativePath = await invoke<string>("copy_thumbnail_file", { absolutePath: picked });
  await scenes.setThumbnailImage(sceneId, relativePath);
  await deleteOldThumbnailFile(oldPath);
}

export async function removeThumbnail(sceneId: number): Promise<void> {
  const oldPath = scenes.scenes.find((s) => s.id === sceneId)?.thumbnail_path ?? null;
  await scenes.setThumbnailImage(sceneId, null);
  await deleteOldThumbnailFile(oldPath);
}
