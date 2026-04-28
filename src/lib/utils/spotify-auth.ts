import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { SpotifyAuthStatus } from "$lib/types/vault";

export async function getSpotifyStatus(): Promise<SpotifyAuthStatus | null> {
  return invoke<SpotifyAuthStatus | null>("spotify_get_auth_status");
}

export async function connectSpotify(): Promise<SpotifyAuthStatus> {
  const authUrl = await invoke<string>("spotify_start_auth_flow");

  // Set up listener BEFORE opening the URL so we don't miss the callback.
  // Capture the unlisten promise so the handler can unregister itself after
  // the first invocation — prevents duplicate firings on subsequent auth flows.
  const statusPromise = new Promise<SpotifyAuthStatus>((resolve, reject) => {
    const unlistenPromise = listen<{ code: string; state: string }>(
      "spotify-auth-callback",
      async (event) => {
        const unlisten = await unlistenPromise;
        unlisten();
        try {
          const result = await invoke<SpotifyAuthStatus>("spotify_exchange_code", {
            code: event.payload.code,
            state: event.payload.state,
          });
          resolve(result);
        } catch (e) {
          reject(e);
        }
      },
    );
  });

  // Now open the browser for the user to authorize
  await openUrl(authUrl);

  return statusPromise;
}

export async function disconnectSpotify(): Promise<void> {
  await invoke("spotify_revoke");
}
